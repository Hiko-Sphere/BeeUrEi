import { describe, it, expect } from 'vitest'
import { isPrivatePeer, rateLimitClientKey } from '../src/auth/clientIp'

/// 限流客户端标识：生产在 Cloudflare 隧道后，req.ip 恒为环回——未登录流量若共享一个桶，
/// 一人打满 login 桶=全站登录 DoS。修复=可信对端(本机/私网)时采信 CF-Connecting-IP（边缘覆写、
/// 不可预置），否则回落 req.ip。攻击面：伪造 CF 头旋转限流桶——本测把每个绕过点都钉死。
describe('isPrivatePeer 对端可信判定', () => {
  it('环回/私段/ULA/v4-mapped 判私网；公网判否', () => {
    for (const a of ['127.0.0.1', '::1', '10.1.2.3', '172.16.0.1', '172.31.255.1', '192.168.1.1', '::ffff:127.0.0.1', 'fd00::1', 'fc00::9'])
      expect(isPrivatePeer(a), a).toBe(true)
    for (const a of ['8.8.8.8', '1.1.1.1', '172.15.0.1', '172.32.0.1', '192.169.0.1', '203.0.113.7', undefined, ''])
      expect(isPrivatePeer(a as string), String(a)).toBe(false)
  })
})

describe('rateLimitClientKey 真实客户端标识', () => {
  const mk = (o: { ip?: string; cf?: string; peer?: string }) => ({
    ip: o.ip ?? '127.0.0.1',
    headers: o.cf !== undefined ? { 'cf-connecting-ip': o.cf } : {},
    socket: { remoteAddress: o.peer ?? o.ip ?? '127.0.0.1' },
  })

  it('经隧道（对端私网）+ CF-Connecting-IP → 用真实客户端 IP（各客户端各自的桶）', () => {
    expect(rateLimitClientKey(mk({ peer: '127.0.0.1', cf: '203.0.113.9' }))).toBe('ip:203.0.113.9')
    // 两个真实客户端经同一隧道进来 → 不同桶（这正是修复的意义）。
    expect(rateLimitClientKey(mk({ peer: '::1', cf: '198.51.100.1' }))).toBe('ip:198.51.100.1')
    expect(rateLimitClientKey(mk({ peer: '127.0.0.1', cf: '203.0.113.9' })))
      .not.toBe(rateLimitClientKey(mk({ peer: '127.0.0.1', cf: '198.51.100.1' })))
  })

  it('无 CF 头（本地开发/直连）→ 回落 req.ip（直连形态本就是真实地址）', () => {
    expect(rateLimitClientKey(mk({ ip: '192.0.2.50' }))).toBe('192.0.2.50')
  })

  it('攻击面①：对端是公网（误直连暴露）却带 CF 头 → 忽略该头，回落 req.ip（伪造头旋转桶失效）', () => {
    expect(rateLimitClientKey(mk({ ip: '203.0.113.200', peer: '203.0.113.200', cf: '9.9.9.9' }))).toBe('203.0.113.200')
  })

  it('攻击面②：只信 CF-Connecting-IP，不信可被客户端预置的 X-Forwarded-For', () => {
    const req = { ip: '127.0.0.1', headers: { 'x-forwarded-for': '9.9.9.9, 10.0.0.1' }, socket: { remoteAddress: '127.0.0.1' } }
    expect(rateLimitClientKey(req)).toBe('127.0.0.1') // XFF 完全不参与 → 回落 req.ip
  })

  it('攻击面③：空 CF 头不当作有效标识（避免 "ip:" 空桶把所有空头请求并到一起）', () => {
    expect(rateLimitClientKey(mk({ peer: '127.0.0.1', cf: '' }))).toBe('127.0.0.1')
  })
})
