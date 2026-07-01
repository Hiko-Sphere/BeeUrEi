import { describe, it, expect } from 'vitest'
import { CodeSendLimiter } from '../src/auth/sendLimiter'
import { buildApp } from '../src/app'
import { MemoryStore } from '../src/db/store'
import type { Mailer } from '../src/mail/mailer'

describe('CodeSendLimiter（验证码发送侧节流）', () => {
  it('60 秒冷却：发后立刻再发被拒，满 60 秒后放行', () => {
    const lim = new CodeSendLimiter(60_000, 3_600_000, 5)
    const t0 = 1_000_000
    expect(lim.check('k', t0).ok).toBe(true)
    lim.record('k', t0)
    const d = lim.check('k', t0 + 30_000)
    expect(d.ok).toBe(false)
    if (!d.ok) {
      expect(d.reason).toBe('cooldown')
      expect(d.retryAfterSec).toBe(30) // 还差 30 秒
    }
    expect(lim.check('k', t0 + 60_000).ok).toBe(true)
  })

  it('窗口上限：超过 maxPerWindow 拒为 too_many', () => {
    const lim = new CodeSendLimiter(0, 3_600_000, 3) // 冷却置 0 以隔离窗口逻辑
    const t = 1_000_000
    for (let i = 0; i < 3; i++) {
      expect(lim.check('k', t + i).ok).toBe(true)
      lim.record('k', t + i)
    }
    const d = lim.check('k', t + 10)
    expect(d.ok).toBe(false)
    if (!d.ok) expect(d.reason).toBe('too_many')
  })

  it('窗口滑出后恢复；不同 key 互不影响', () => {
    const lim = new CodeSendLimiter(60_000, 60_000, 5)
    const t = 1_000_000
    lim.record('a', t)
    expect(lim.check('b', t).ok).toBe(true) // 不同收件人不受影响
    expect(lim.check('a', t + 60_001).ok).toBe(true) // 超过窗口，旧记录滑出
  })
})

describe('发送侧节流（端到端）', () => {
  it('连续请求登录验证码：第二次 60 秒内被 429 code_cooldown，且没真发第二封', async () => {
    const sent: { to: string }[] = []
    const mailer: Mailer = { async send(to) { sent.push({ to }) } }
    const app = buildApp(new MemoryStore(), { mailer })
    const first = await app.inject({ method: 'POST', url: '/api/auth/email/request-code', payload: { email: 'a@example.com' } })
    expect(first.statusCode).toBe(200)
    const second = await app.inject({ method: 'POST', url: '/api/auth/email/request-code', payload: { email: 'a@example.com' } })
    expect(second.statusCode).toBe(429)
    expect(second.json().error).toBe('code_cooldown')
    expect(second.json().retryAfterSec).toBeGreaterThan(0)
    expect(second.headers['retry-after']).toBeTruthy()
    expect(sent.length).toBe(1) // 第二次在发送前即被拒
    await app.close()
  })

  it('找回密码连点也被 429（对任意标识一致，保持反枚举）', async () => {
    const app = buildApp(new MemoryStore(), { mailer: { async send() {} } })
    const p = { username: 'nobody-here' } // 不存在的账号也一视同仁
    expect((await app.inject({ method: 'POST', url: '/api/auth/forgot-password', payload: p })).statusCode).toBe(200)
    const second = await app.inject({ method: 'POST', url: '/api/auth/forgot-password', payload: p })
    expect(second.statusCode).toBe(429)
    expect(second.json().error).toBe('code_cooldown')
    await app.close()
  })

  it('设置邮箱验证码连点也被 429（按用户节流，防经改邮箱轰炸不同地址）', async () => {
    const sent: { to: string }[] = []
    const app = buildApp(new MemoryStore(), { mailer: { async send(to) { sent.push({ to }) } } })
    const reg = (await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'setmail', password: 'secret123' } })).json()
    const auth = { authorization: `Bearer ${reg.token}` }
    expect((await app.inject({ method: 'POST', url: '/api/account/email', headers: auth, payload: { email: 'e@example.com' } })).statusCode).toBe(200)
    // 第二次换一个**不同**邮箱：send key 按 user 而非按邮箱，故仍 429（防扫地址轰炸）
    const second = await app.inject({ method: 'POST', url: '/api/account/email', headers: auth, payload: { email: 'e2@example.com' } })
    expect(second.statusCode).toBe(429)
    expect(second.json().error).toBe('code_cooldown')
    expect(sent.length).toBe(1) // 第二次在发送前即被拒
    await app.close()
  })

  it('设置邮箱有 fastify 每分钟兜底：突发连打超 5 次被限流(区别于 codeSend 冷却)——补 codeSend check/record 夹 await 的并发绕过', async () => {
    // codeSend 的 check→await mailer.send→record 之间有让点，并发连发会在 record 前都过 check 绕过冷却；
    // 此端点原无 fastify 兜底（不同于 auth/email/request-code）。fastify 限流在 onRequest 同步计数、
    // 早于处理器且不受 await 竞态影响，兜住突发。这里逐个打 6 次：fastify 计满所有请求，第 6 次越限被
    // fastify 429（error 非 'code_cooldown'，而是 'Too Many Requests'），证明兜底生效。
    const app = buildApp(new MemoryStore(), { mailer: { async send() {} } })
    const reg = (await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'burstmail', password: 'secret123' } })).json()
    const auth = { authorization: `Bearer ${reg.token}` }
    const errors: string[] = []
    for (let i = 0; i < 6; i++) {
      const res = await app.inject({ method: 'POST', url: '/api/account/email', headers: auth, payload: { email: `b${i}@example.com` } })
      errors.push(res.statusCode === 429 ? String(res.json().error) : 'ok')
    }
    // 第 6 次被 fastify 限流兜底（越过 max:5），错误是限流文案而非 codeSend 的 'code_cooldown'——证明兜底生效。
    expect(errors[5]).toMatch(/Rate limit/)
    expect(errors[5]).not.toBe('code_cooldown')
    await app.close()
  })
})
