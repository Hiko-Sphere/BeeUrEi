import { describe, it, expect } from 'vitest'
import { emailVerificationMail, passwordResetMail } from '../src/mail/templates'

describe('交易邮件模板（验证码 / 重置密码）', () => {
  const cases = [
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

  it('两类邮件主题不同，便于收件人区分', () => {
    expect(emailVerificationMail('1').subject).not.toBe(passwordResetMail('1').subject)
  })
})
