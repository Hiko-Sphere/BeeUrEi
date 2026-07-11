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
})
