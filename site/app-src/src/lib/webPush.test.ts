// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { urlBase64ToUint8Array, registerServiceWorker } from './webPush'

describe('urlBase64ToUint8Array（VAPID 公钥解码）', () => {
  it('base64url（-/_、无填充）正确还原字节', () => {
    // 'hello' 的 base64 = aGVsbG8=（base64url 去填充：aGVsbG8）
    expect([...urlBase64ToUint8Array('aGVsbG8')]).toEqual([104, 101, 108, 108, 111])
  })
  it('含 -/_ 的 url 安全字符正确映射到 +//', () => {
    // 0xfb 0xff → base64 '+/8=' → base64url '-_8'
    expect([...urlBase64ToUint8Array('-_8')]).toEqual([0xfb, 0xff])
  })
  it('真实 VAPID 公钥长度（P-256 未压缩点 65 字节）', () => {
    // 87 个 base64url 字符 = 65 字节
    const key = 'BF' + 'A'.repeat(85)
    expect(urlBase64ToUint8Array(key).length).toBe(65)
  })
})

describe('registerServiceWorker（启动即注册 SW，离线兜底覆盖所有协助者）', () => {
  afterEach(() => { vi.restoreAllMocks() })

  it('注册 /app/sw.js（不请求通知权限、不订阅推送）', async () => {
    const register = vi.fn().mockResolvedValue({})
    Object.defineProperty(navigator, 'serviceWorker', { value: { register }, configurable: true })
    await registerServiceWorker()
    expect(register).toHaveBeenCalledOnce()
    expect(String(register.mock.calls[0][0])).toMatch(/\/app\/sw\.js/) // 用 SW_URL（不涉 Notification.requestPermission / pushManager）
  })

  it('register 失败(不支持/权限/网络)静默不抛', async () => {
    const register = vi.fn().mockRejectedValue(new Error('nope'))
    Object.defineProperty(navigator, 'serviceWorker', { value: { register }, configurable: true })
    await expect(registerServiceWorker()).resolves.toBeUndefined()
  })
})
