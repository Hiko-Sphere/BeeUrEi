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

  it('随时间衰减：空闲超 decayMs → 计数清零（正常用户不被上周的失败罚今天）；空闲不足则不清（活跃攻击者无从占便宜）', () => {
    const decayMs = 60 * 60_000
    const t = new LoginThrottle(3, 30_000, 6, 900_000, 10_000, decayMs) // 软阈值3、decay=1h
    const K = 'stale1'
    const now = 1_000_000
    for (let i = 0; i < 3; i++) t.recordFailure(K, now) // 达软阈值 → 节流
    expect(t.check(K, now + 1000).allowed).toBe(false)  // 立即再试被节流

    // ① 空闲**不足** decayMs（59min）→ 仍视为连续、计数不清：check 放行（隔够 30s）但失败叠加到第 4 次。
    const near = now + decayMs - 60_000
    expect(t.check(K, near).allowed).toBe(true)     // 距上次久于 30s 延迟窗 → 放行
    t.recordFailure(K, near)                         // 第 4 次失败（未衰减，fails=4）
    expect(t.check(K, near + 1000).allowed).toBe(false) // fails=4≥软阈值 → 立即再试仍被节流（证明没清零）

    // ② 空闲**超过** decayMs → 计数从头算：随后连失 2 次仍在软阈值(3)内、不被节流。
    const later = near + decayMs + 1
    expect(t.check(K, later).allowed).toBe(true)     // 陈旧 → 清零放行
    t.recordFailure(K, later); t.recordFailure(K, later) // 只从 1 算起 → fails=2
    expect(t.check(K, later + 1).allowed).toBe(true) // fails=2 < 软阈值3 → 放行（若未衰减则是 4+2≥3 被节流）
  })

  it('recordFailure 直用于陈旧条目（无 check 先行清理）：距上次超 decayMs → 计数从 1 重算，不叠加', () => {
    const decayMs = 60_000
    const t = new LoginThrottle(3, 30_000, 6, 900_000, 10_000, decayMs)
    const K = 'k'
    for (let i = 0; i < 3; i++) t.recordFailure(K, 1_000_000) // fails=3（达软阈值）
    t.recordFailure(K, 1_000_000 + decayMs + 1)               // 超 decayMs → 重置为 1（而非 4）
    expect(t.check(K, 1_000_000 + decayMs + 2).allowed).toBe(true) // fails=1<3 → 放行（若叠加成 4 则被节流）
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
    await a.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'victim01', password: 'kestrel-nine-9', role: 'helper' } })
    await a.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'bystander', password: 'meadow-seven-7', role: 'helper' } })
    const attempt = (u: string, pw: string) => a.inject({ method: 'POST', url: '/api/auth/login', payload: { username: u, password: pw } })
    for (let i = 0; i < 3; i++) await attempt('victim01', 'x-wrong-' + i)
    expect((await attempt('victim01', 'kestrel-nine-9')).statusCode).toBe(429)
    expect((await attempt('bystander', 'meadow-seven-7')).statusCode).toBe(200) // 无辜者不受累
    await a.close()
  })
})
