import { describe, it, expect } from 'vitest'
import { classifyIdentifier, normalizePhoneInput } from './identifier'

describe('classifyIdentifier', () => {
  it('email：含 @', () => {
    expect(classifyIdentifier('alice@mail.com')).toBe('email')
    expect(classifyIdentifier('a@b')).toBe('email')
  })
  it('phone：去分隔符后 +?加 ≥5 位数字', () => {
    expect(classifyIdentifier('13800138000')).toBe('phone')
    expect(classifyIdentifier('+86 138 0013 8000')).toBe('phone')
    expect(classifyIdentifier('138-0013-8000')).toBe('phone')
    expect(classifyIdentifier('+1 555 12')).toBe('phone') // 6 位数字
  })
  it('username：纯名 / 数字不足 5 位', () => {
    expect(classifyIdentifier('alice')).toBe('username')
    expect(classifyIdentifier('user_42')).toBe('username') // 含下划线非手机
    expect(classifyIdentifier('1234')).toBe('username')     // 仅 4 位数字
  })
  it('normalizePhoneInput 去空格与连字符', () => {
    expect(normalizePhoneInput('+86 138-0013-8000')).toBe('+8613800138000')
  })
})
