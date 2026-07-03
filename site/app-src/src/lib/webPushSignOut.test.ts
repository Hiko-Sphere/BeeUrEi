// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { unsubscribeWebPushOnSignOut } from './webPush'

// 登出退订契约：①用**调用方快照**的 token 发 DELETE（tokenStore 此刻已被清，不能依赖它）；
// ②服务端删完浏览器侧也 unsubscribe（双保险）；③无订阅/无 SW/网络失败一律静默（登出不被阻断）。
describe('unsubscribeWebPushOnSignOut', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it('有订阅：DELETE 带快照 token + 浏览器侧退订', async () => {
    const unsubscribe = vi.fn().mockResolvedValue(true)
    const sub = { endpoint: 'https://push.example/ep1', unsubscribe }
    vi.stubGlobal('navigator', { serviceWorker: { getRegistration: vi.fn().mockResolvedValue({ pushManager: { getSubscription: () => Promise.resolve(sub) } }) } })
    const fetchMock = vi.fn().mockResolvedValue({ ok: true })
    vi.stubGlobal('fetch', fetchMock)
    await unsubscribeWebPushOnSignOut('SNAPSHOT_TOKEN')
    expect(fetchMock).toHaveBeenCalledOnce()
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/api/push/web-subscribe')
    expect(init.method).toBe('DELETE')
    expect(init.headers.authorization).toBe('Bearer SNAPSHOT_TOKEN') // 快照 token，非 tokenStore
    expect(JSON.parse(init.body).endpoint).toBe('https://push.example/ep1')
    expect(unsubscribe).toHaveBeenCalledOnce() // 浏览器侧双保险
  })

  it('无订阅：不发请求；服务端失败：浏览器侧仍退订；全程不抛', async () => {
    vi.stubGlobal('navigator', { serviceWorker: { getRegistration: vi.fn().mockResolvedValue({ pushManager: { getSubscription: () => Promise.resolve(null) } }) } })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    await expect(unsubscribeWebPushOnSignOut('t')).resolves.toBeUndefined()
    expect(fetchMock).not.toHaveBeenCalled()
    // 服务端 DELETE 抛错 → 浏览器侧仍退订
    const unsubscribe = vi.fn().mockResolvedValue(true)
    vi.stubGlobal('navigator', { serviceWorker: { getRegistration: vi.fn().mockResolvedValue({ pushManager: { getSubscription: () => Promise.resolve({ endpoint: 'https://e/2', unsubscribe }) } }) } })
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    await expect(unsubscribeWebPushOnSignOut('t')).resolves.toBeUndefined()
    expect(unsubscribe).toHaveBeenCalledOnce()
  })
})

describe('resyncWebPushSubscription（自愈重同步）', () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

  it('浏览器侧已订阅 → 幂等重传服务端（upsert 同端点不产生新行）', async () => {
    const { resyncWebPushSubscription } = await import('./webPush')
    const { api } = await import('./api')
    const spy = vi.spyOn(api, 'webPushSubscribe').mockResolvedValue({} as never)
    vi.stubGlobal('Notification', { permission: 'granted' })
    vi.stubGlobal('PushManager', function () {})
    vi.stubGlobal('navigator', { serviceWorker: { getRegistration: vi.fn().mockResolvedValue({ pushManager: { getSubscription: () => Promise.resolve({
      toJSON: () => ({ endpoint: 'https://e/1', keys: { p256dh: 'k', auth: 'a' } }) }) } }) } })
    vi.stubGlobal('window', globalThis)
    await resyncWebPushSubscription()
    expect(spy).toHaveBeenCalledWith({ endpoint: 'https://e/1', keys: { p256dh: 'k', auth: 'a' } })
  })

  it('未订阅/权限未授 → 零请求；服务端失败不抛（下次设置页再试）', async () => {
    const { resyncWebPushSubscription } = await import('./webPush')
    const { api } = await import('./api')
    const spy = vi.spyOn(api, 'webPushSubscribe').mockRejectedValue(new Error('x'))
    vi.stubGlobal('Notification', { permission: 'denied' })
    vi.stubGlobal('PushManager', function () {})
    vi.stubGlobal('navigator', { serviceWorker: { getRegistration: vi.fn() } })
    vi.stubGlobal('window', globalThis)
    await expect(resyncWebPushSubscription()).resolves.toBeUndefined()
    expect(spy).not.toHaveBeenCalled()
    // 已授权但上报失败 → 仍不抛
    vi.stubGlobal('Notification', { permission: 'granted' })
    vi.stubGlobal('navigator', { serviceWorker: { getRegistration: vi.fn().mockResolvedValue({ pushManager: { getSubscription: () => Promise.resolve({
      toJSON: () => ({ endpoint: 'https://e/2', keys: { p256dh: 'k', auth: 'a' } }) }) } }) } })
    await expect(resyncWebPushSubscription()).resolves.toBeUndefined()
  })
})
