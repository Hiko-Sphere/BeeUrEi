// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { api, APIError, tokenStore, setUnauthorizedHandler } from './api'

describe('rawFetch 请求超时（防网络挂死导致 UI 无限转圈）', () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

  it('30s 无响应 → AbortController 中止并抛 network 错误', async () => {
    vi.useFakeTimers()
    // 模拟网络挂死：fetch 永不 resolve，但遵守 abort 信号（真实 fetch 行为）。
    vi.stubGlobal('fetch', (_url: string, opts: { signal: AbortSignal }) =>
      new Promise((_res, rej) => { opts.signal.addEventListener('abort', () => rej(new DOMException('aborted', 'AbortError'))) }))
    const p = api.appConfig().then(() => null).catch((e: unknown) => e)
    await vi.advanceTimersByTimeAsync(30_000) // 推进到 30s 超时点
    const err = await p
    expect(err).toBeInstanceOf(APIError)
    expect((err as APIError).code).toBe('network') // 超时按网络错误处理
  })
})

const jres = (status: number, body: unknown) => ({ status, ok: status >= 200 && status < 300, json: async () => body })
const seedUser = () => tokenStore.set('AT_OLD', 'RT1', { id: 'u1', username: 'u', displayName: 'U', role: 'blind', status: 'active' })

describe('rawFetch 401 续期与远程登出', () => {
  afterEach(() => { vi.unstubAllGlobals(); tokenStore.clear(); setUnauthorizedHandler(() => {}) })

  it('续期成功但重放仍 401（会话已被远程撤销/封禁）→ 立即登出（清 token + 触发 onUnauthorized）', async () => {
    seedUser()
    let loggedOut = false
    setUnauthorizedHandler(() => { loggedOut = true })
    let refreshCalls = 0
    vi.stubGlobal('fetch', (url: string) => {
      if (String(url).includes('/api/auth/refresh')) { refreshCalls++; return Promise.resolve(jres(200, { token: 'AT_NEW', refreshToken: 'RT2' })) }
      return Promise.resolve(jres(401, { error: 'unauthorized' })) // 首次 + 重放都 401
    })
    const err = await api.appConfig().then(() => null).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(APIError)
    expect((err as APIError).status).toBe(401)
    expect(refreshCalls).toBe(1)          // 只续期一次（retry=false 防死循环）
    expect(loggedOut).toBe(true)          // 本修复点：重放仍 401 也立即登出，不留中间态
    expect(tokenStore.token).toBeNull()   // 本地 token 已清
  })

  it('续期成功且重放成功 → 用新 token 返回数据、不登出（回归：正常续期路径不受影响）', async () => {
    seedUser()
    let loggedOut = false
    setUnauthorizedHandler(() => { loggedOut = true })
    let firstCfg = true
    vi.stubGlobal('fetch', (url: string) => {
      if (String(url).includes('/api/auth/refresh')) return Promise.resolve(jres(200, { token: 'AT_NEW', refreshToken: 'RT2' }))
      if (firstCfg) { firstCfg = false; return Promise.resolve(jres(401, { error: 'unauthorized' })) }
      return Promise.resolve(jres(200, { minAppVersion: '1.0.0' }))
    })
    const cfg = await api.appConfig() as { minAppVersion?: string }
    expect(cfg.minAppVersion).toBe('1.0.0')
    expect(loggedOut).toBe(false)         // 恢复成功不应登出
    expect(tokenStore.token).toBe('AT_NEW') // 已换用新 token
  })

  it('续期遇瞬时故障(5xx 部署/重启) → **不登出、不清令牌**，当网络错误上抛（下轮自愈；本修复点）', async () => {
    seedUser()
    let loggedOut = false
    setUnauthorizedHandler(() => { loggedOut = true })
    vi.stubGlobal('fetch', (url: string) => {
      if (String(url).includes('/api/auth/refresh')) return Promise.resolve(jres(503, { error: 'unavailable' }))
      return Promise.resolve(jres(401, { error: 'unauthorized' })) // access token 过期 → 触发续期
    })
    const err = await api.appConfig().then(() => null).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(APIError)
    expect((err as APIError).code).toBe('network') // 瞬时：当网络错误
    expect(loggedOut).toBe(false)                  // 关键：不登出（此前一次抖动即静默踢下线）
    expect(tokenStore.token).toBe('AT_OLD')        // 令牌保留（有效 refresh token 未被清）
    expect(tokenStore.refresh).toBe('RT1')
  })

  it('续期遇网络失败 → 同样不登出、不清令牌（瞬时抖动自愈）', async () => {
    seedUser()
    let loggedOut = false
    setUnauthorizedHandler(() => { loggedOut = true })
    vi.stubGlobal('fetch', (url: string) => {
      if (String(url).includes('/api/auth/refresh')) return Promise.reject(new TypeError('network down'))
      return Promise.resolve(jres(401, { error: 'unauthorized' }))
    })
    const err = await api.appConfig().then(() => null).catch((e: unknown) => e)
    expect((err as APIError).code).toBe('network')
    expect(loggedOut).toBe(false)
    expect(tokenStore.token).toBe('AT_OLD')
  })

  it('续期被服务端拒(401 invalid_refresh_token：撤销/封禁/过期) → 清 token + 登出（真失效才登出）', async () => {
    seedUser()
    let loggedOut = false
    setUnauthorizedHandler(() => { loggedOut = true })
    vi.stubGlobal('fetch', (url: string) => {
      if (String(url).includes('/api/auth/refresh')) return Promise.resolve(jres(401, { error: 'invalid_refresh_token' }))
      return Promise.resolve(jres(401, { error: 'unauthorized' }))
    })
    const err = await api.appConfig().then(() => null).catch((e: unknown) => e)
    expect((err as APIError).status).toBe(401)
    expect(loggedOut).toBe(true)       // refresh token 真被拒才登出
    expect(tokenStore.token).toBeNull()
  })

  it('在途续期期间登出（signOut 清了 token）→ 续期即便成功也**不复活**令牌（共享电脑防泄漏）', async () => {
    seedUser()
    setUnauthorizedHandler(() => {})
    let firstCfg = true
    vi.stubGlobal('fetch', (url: string) => {
      if (String(url).includes('/api/auth/refresh')) {
        tokenStore.clear() // 模拟：续期在途时用户登出（同步清了本地令牌）
        return Promise.resolve(jres(200, { token: 'AT_NEW', refreshToken: 'RT2' })) // 服务端仍返回了新令牌
      }
      // 首次 401 触发 refresh；**重放成功**（模拟复活的令牌若被写回则请求会通过、令牌残留于共享电脑）。
      if (firstCfg) { firstCfg = false; return Promise.resolve(jres(401, { error: 'unauthorized' })) }
      return Promise.resolve(jres(200, { minAppVersion: '1.0.0' }))
    })
    await api.appConfig().then(() => null).catch(() => {})
    expect(tokenStore.token).toBeNull()   // **未被复活**（无守卫时会写回 AT_NEW 且因重放成功而残留 → 会话恢复）
    expect(tokenStore.refresh).toBeNull()
  })

  it('强制登出把清除前的 access token 传给登出处理器（供退订 Web Push，防共享浏览器继续收上一用户告警）', async () => {
    seedUser() // AT_OLD
    let gotToken: string | undefined = 'unset'
    setUnauthorizedHandler((tk?: string) => { gotToken = tk })
    vi.stubGlobal('fetch', (url: string) => {
      if (String(url).includes('/api/auth/refresh')) return Promise.resolve(jres(401, { error: 'invalid_refresh_token' })) // 真失效 → 登出
      return Promise.resolve(jres(401, { error: 'unauthorized' }))
    })
    await api.appConfig().then(() => null).catch(() => {})
    expect(gotToken).toBe('AT_OLD') // 清除前的 token 被传入（登出处理器据此退订 web push）
  })

  it('并发去重：token 过期时多个在途请求共享**一次** refresh（防雷鸣群刷新→refresh token 互相轮换失效→级联登出）', async () => {
    seedUser()
    setUnauthorizedHandler(() => {})
    let refreshCalls = 0
    let releaseRefresh: (() => void) | null = null
    const firstHit = new Set<string>() // 每个业务端点：首打 401、续期后重放 200
    vi.stubGlobal('fetch', (url: string) => {
      const u = String(url)
      if (u.includes('/api/auth/refresh')) {
        refreshCalls++
        // 刷新悬住，制造"多个 401 同时等同一次续期"的窗口——若无 `if(refreshing) return refreshing` 去重，
        // 每个 401 各自发一次 refresh，服务端每次轮换 refresh token，先回的令牌把后回的作废→重放全 401→级联登出。
        return new Promise((r) => { releaseRefresh = () => r(jres(200, { token: 'AT_NEW', refreshToken: 'RT2' })) })
      }
      if (!firstHit.has(u)) { firstHit.add(u); return Promise.resolve(jres(401, { error: 'unauthorized' })) }
      return Promise.resolve(jres(200, { ok: true }))
    })
    // 三个不同端点并发触发 401（同一 token 过期时的真实场景：轮询+用户操作同时打）。
    const ps = [api.appConfig(), api.me().catch(() => 'me-ok'), api.unreadSummary()].map((p) => p.catch((e) => e))
    await Promise.resolve(); await Promise.resolve() // 让三个请求都跑过入口并进入 tryRefresh 排队
    releaseRefresh!()
    await Promise.all(ps)
    expect(refreshCalls).toBe(1)          // 关键：三个 401 只触发一次续期
    expect(tokenStore.token).toBe('AT_NEW')
  })

  it('续期返回 2xx 却无 token（异常/畸形响应）→ 保守当瞬时故障，不误清有效令牌', async () => {
    seedUser()
    let loggedOut = false
    setUnauthorizedHandler(() => { loggedOut = true })
    vi.stubGlobal('fetch', (url: string) => {
      if (String(url).includes('/api/auth/refresh')) return Promise.resolve(jres(200, { refreshToken: 'RT2' })) // 200 但缺 token
      return Promise.resolve(jres(401, { error: 'unauthorized' }))
    })
    const err = await api.appConfig().then(() => null).catch((e: unknown) => e)
    expect((err as APIError).code).toBe('network') // 瞬时上抛
    expect(loggedOut).toBe(false)                  // 不登出
    expect(tokenStore.refresh).toBe('RT1')         // 有效 refresh token 保留（未被畸形响应误清）
  })
})
