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
})
