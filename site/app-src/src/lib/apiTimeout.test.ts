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
})
