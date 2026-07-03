import { describe, it, expect } from 'vitest'
import { urlBase64ToUint8Array } from './webPush'

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
