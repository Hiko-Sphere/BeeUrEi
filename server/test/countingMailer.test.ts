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

  it('失败时把**错误原因**一并喂给 onOutcome（供面板显示"为什么发不出去"）；成功时无错误参数', async () => {
    const seen: Array<{ ok: boolean; err?: string }> = []
    const onOutcome = (ok: boolean, err?: string) => seen.push({ ok, err })
    await new CountingMailer({ async send() {} }, onOutcome).send('a@b.com', 's', 't')
    expect(seen[0]).toEqual({ ok: true, err: undefined })
    await expect(new CountingMailer({ async send() { throw new Error('535 authentication failed') } }, onOutcome)
      .send('a@b.com', 's', 't')).rejects.toThrow('535')
    expect(seen[1]).toEqual({ ok: false, err: '535 authentication failed' })
    // 非 Error 抛出（如字符串）也转成字符串上报，不崩。
    await expect(new CountingMailer({ async send() { throw 'boom' } }, onOutcome).send('a@b.com', 's', 't')).rejects.toBeTruthy()
    expect(seen[2]).toEqual({ ok: false, err: 'boom' })
  })
})
