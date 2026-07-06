import { describe, it, expect } from 'vitest'
import { loginCodeMail, emailVerificationMail, passwordResetMail, emailChangedAlertMail } from '../src/mail/templates'

describe('交易邮件模板（登录码 / 邮箱验证 / 重置密码）', () => {
  const cases = [
    ['login code', loginCodeMail],
    ['email verification', emailVerificationMail],
    ['password reset', passwordResetMail],
  ] as const

  for (const [name, build] of cases) {
    it(`${name}: 双语 · 含码 · 有效期+反钓鱼 · 自动填充友好 · 合法 HTML`, () => {
      const code = '428913'
      const m = build(code)
      // 主题双语、品牌
      expect(m.subject).toContain('BeeUrEi')
      expect(m.subject).toMatch(/\//) // zh / en
      // 验证码出现在正文与 HTML（单测与 iOS 自动填充据此提取）
      expect(m.text).toContain(code)
      expect(m.html).toContain(code)
      // 自动填充友好措辞（"验证码是：CODE" / "code is: CODE"）
      expect(m.text).toContain(`验证码是：${code}`)
      expect(m.text).toContain(`code is: ${code}`)
      // 双语
      expect(m.text).toMatch(/验证码/)
      expect(m.text).toMatch(/code/i)
      // 有效期 + 反钓鱼
      expect(m.text).toMatch(/10 分钟/)
      expect(m.text).toMatch(/10 minutes/)
      expect(m.text).toContain('绝不会主动向你索要')
      expect(m.text).toMatch(/never ask you for this code/i)
      // 误收忽略
      expect(m.text).toMatch(/忽略本邮件/)
      // HTML 结构完整、含品牌与官网、自动发送声明
      expect(m.html.startsWith('<!doctype html>')).toBe(true)
      expect(m.html).toContain('beeurei.hikosphere.com')
      expect(m.html).toContain('蜂之眼')
      expect(m.html).toMatch(/do not reply/i)
      // HTML 标签基本配平（<table> 数量与 </table> 一致），防模板破损
      expect((m.html.match(/<table/g) || []).length).toBe((m.html.match(/<\/table>/g) || []).length)
    })
  }

  it('三类邮件主题互不相同，便于收件人区分', () => {
    const subjects = [loginCodeMail('1').subject, emailVerificationMail('1').subject, passwordResetMail('1').subject]
    expect(new Set(subjects).size).toBe(3)
  })
})

describe('邮箱变更告警邮件（发给旧邮箱）', () => {
  it('双语 · 含新邮箱 · 无验证码 · 品牌与自动发送声明 · 合法 HTML', () => {
    const m = emailChangedAlertMail('newbie@example.com')
    expect(m.subject).toContain('BeeUrEi')
    expect(m.subject).toMatch(/\//)                    // zh / en
    expect(m.text).toContain('newbie@example.com')     // 正文含新邮箱（本人知去向）
    expect(m.html).toContain('newbie@example.com')
    expect(m.text).toMatch(/邮箱.*(更改|改为)/)         // 中文点明"改邮箱"
    expect(m.text).toMatch(/changed/i)                 // 英文点明 changed
    expect(m.text).toMatch(/重置密码/)                  // 抢救指引：改密
    expect(m.text).toMatch(/reset your password/i)
    expect(m.html.startsWith('<!doctype html>')).toBe(true)
    expect(m.html).toContain('蜂之眼')
    expect(m.html).toMatch(/do not reply/i)
    expect((m.html.match(/<table/g) || []).length).toBe((m.html.match(/<\/table>/g) || []).length)
  })

  it('HTML 转义新邮箱（防邮件 HTML 注入：用户可控值）', () => {
    const m = emailChangedAlertMail('a"><script>x</script>@evil.com')
    expect(m.html).not.toContain('<script>')            // 原样标签绝不进 HTML
    expect(m.html).toContain('&lt;script&gt;')          // 已转义
  })

  it('与验证码邮件主题不同（收件人一眼分清"是告警不是验证码"）', () => {
    expect(emailChangedAlertMail('x@y.com').subject).not.toBe(emailVerificationMail('1').subject)
  })
})
