import { describe, it, expect } from 'vitest'
import { CountingMailer, type Mailer } from '../src/mail/mailer'

// 邮件送达计数装饰器：把 send 成/败喂给 onOutcome（进 /metrics + admin 面板），失败照旧向上抛（保 503 契约）。
describe('CountingMailer', () => {
  it('成功 → onOutcome(true)；失败 → onOutcome(false) 且**重新抛出**（不吞，路由才能回 503 mail_unavailable）', async () => {
    const outcomes: boolean[] = []
    const okInner: Mailer = { async send() { /* 成功 */ } }
    await new CountingMailer(okInner, (b) => outcomes.push(b)).send('a@b.com', 'subj', 'body')
    expect(outcomes).toEqual([true])

    // 失败路径：内层抛（如 SMTP 535 授权失败）→ 计 false + 原样抛出。
    const failInner: Mailer = { async send() { throw new Error('535 authentication failed') } }
    await expect(new CountingMailer(failInner, (b) => outcomes.push(b)).send('a@b.com', 's', 't'))
      .rejects.toThrow('535')
    expect(outcomes).toEqual([true, false])
  })

  it('透传全部参数（to/subject/text/html）给内层', async () => {
    let seen: unknown[] = []
    const inner: Mailer = { async send(to, subject, text, html) { seen = [to, subject, text, html] } }
    await new CountingMailer(inner, () => {}).send('x@y.com', 'S', 'T', '<b>H</b>')
    expect(seen).toEqual(['x@y.com', 'S', 'T', '<b>H</b>'])
  })
})
