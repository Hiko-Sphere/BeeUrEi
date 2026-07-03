import { describe, it, expect, afterEach, vi } from 'vitest'
import { buildApp } from '../src/app'
import { MemoryStore } from '../src/db/store'
import { LoginThrottle } from '../src/auth/loginThrottle'

// 按账号登录节流（NIST 800-63B）：分布式撞库防护——递进延迟而非硬锁，正确密码同受节流。
describe('LoginThrottle（纯逻辑）', () => {
  it('软阈值前不干预；达到后按 delay 放行；成功清零；硬阈值升级冷却', () => {
    const t = new LoginThrottle(3, 30_000, 6, 900_000)
    const K = 'u1'
    let now = 1_000_000
    // 前 2 次失败不影响放行
    t.recordFailure(K, now); t.recordFailure(K, now)
    expect(t.check(K, now).allowed).toBe(true)
    // 第 3 次失败达软阈值 → 需隔 30s
    t.recordFailure(K, now)
    expect(t.check(K, now + 1000).allowed).toBe(false)
    expect(t.check(K, now + 1000).retryAfterMs).toBeGreaterThan(0)
    expect(t.check(K, now + 30_001).allowed).toBe(true)   // 隔够放行
    t.recordFailure(K, now + 30_001)                       // 又失败（第 4 次）
    expect(t.check(K, now + 31_000).allowed).toBe(false)   // 基准更新，再等
    // 累积到硬阈值 → 冷却 15 分钟
    now += 100_000
    for (let i = 0; i < 3; i++) { const c = t.check(K, now); if (c.allowed) t.recordFailure(K, now); now += 31_000 }
    expect(t.check(K, now).allowed).toBe(false)
    expect(t.check(K, now).retryAfterMs).toBeGreaterThan(30_000) // 已是冷却级
    // 成功清零（冷却后正确登录）
    t.recordSuccess(K)
    expect(t.check(K, now).allowed).toBe(true)
  })

  it('LRU 有界：超上限驱逐最老（海量账号名不放大内存）', () => {
    const t = new LoginThrottle(1, 30_000, 50, 900_000, 3)
    for (const k of ['a', 'b', 'c', 'd']) t.recordFailure(k, 1000)
    expect(t.check('a', 1001).allowed).toBe(true)  // a 被驱逐 → 无记录 → 放行
    expect(t.check('d', 1001).allowed).toBe(false) // d 仍在
  })
})

describe('登录节流（端到端）', () => {
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
  // 注入短延迟实例（软阈值 3、延迟 120ms）：真实计时，不碰 fake timers（会卡死 fastify 内部定时器）。
  const shortApp = () => buildApp(new MemoryStore(), { loginThrottle: new LoginThrottle(3, 120, 50, 900_000) })

  it('连败达阈值后即便**密码正确**也 429 + retry-after；隔窗放行成功即清零', async () => {
    const a = shortApp()
    await a.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'stuffme', password: 'right-pass-9', role: 'helper' } })
    const attempt = (pw: string) => a.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'stuffme', password: pw } })
    for (let i = 0; i < 3; i++) expect((await attempt('wrong-pass-' + i)).statusCode).toBe(401)
    // 第 4 次：连正确密码都 429（否则撞库者猜中即进，节流形同虚设）
    const blocked = await attempt('right-pass-9')
    expect(blocked.statusCode).toBe(429)
    expect(blocked.json().error).toBe('too_many_attempts')
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThanOrEqual(1)
    // 窗口过后放行，正确密码成功 → 清零 → 立即再登录也成功
    await sleep(150)
    expect((await attempt('right-pass-9')).statusCode).toBe(200)
    expect((await attempt('right-pass-9')).statusCode).toBe(200)
    await a.close()
  })

  it('节流按账号隔离：他人账号不受影响；2FA 错码同计入', async () => {
    const a = shortApp()
    await a.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'victim01', password: 'victim-pass9', role: 'helper' } })
    await a.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'bystander', password: 'bystander-p9', role: 'helper' } })
    const attempt = (u: string, pw: string) => a.inject({ method: 'POST', url: '/api/auth/login', payload: { username: u, password: pw } })
    for (let i = 0; i < 3; i++) await attempt('victim01', 'x-wrong-' + i)
    expect((await attempt('victim01', 'victim-pass9')).statusCode).toBe(429)
    expect((await attempt('bystander', 'bystander-p9')).statusCode).toBe(200) // 无辜者不受累
    await a.close()
  })
})
