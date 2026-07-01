import { describe, it, expect } from 'vitest'
import { CodeRegistry } from '../src/auth/codes'

describe('CodeRegistry', () => {
  it('issue 返回明文，verify 成功消费一次', () => {
    const r = new CodeRegistry()
    const code = r.issue('reset:u1', 0, '123456')
    expect(code).toBe('123456')
    expect(r.has('reset:u1')).toBe(true)
    expect(r.verify('reset:u1', '123456', 0)).toBe(true)
    expect(r.has('reset:u1')).toBe(false) // 用过即删
    expect(r.verify('reset:u1', '123456', 0)).toBe(false) // 不能重用
  })

  it('错误码累计尝试，超限即作废', () => {
    const r = new CodeRegistry(10 * 60 * 1000, 3)
    r.issue('k', 0, '111111')
    expect(r.verify('k', 'x', 0)).toBe(false)
    expect(r.verify('k', 'x', 0)).toBe(false)
    expect(r.verify('k', 'x', 0)).toBe(false) // 第 3 次错 → 超限删除
    expect(r.verify('k', '111111', 0)).toBe(false) // 正确码也不再有效
  })

  it('过期作废', () => {
    const r = new CodeRegistry(60_000)
    r.issue('k', 0, '111111')
    expect(r.verify('k', '111111', 61_000)).toBe(false)
  })

  it('issue 覆盖旧码', () => {
    const r = new CodeRegistry()
    r.issue('k', 0, '111111')
    r.issue('k', 0, '222222')
    expect(r.verify('k', '111111', 0)).toBe(false)
    expect(r.verify('k', '222222', 0)).toBe(true)
  })

  it('随机码为 6 位数字', () => {
    const r = new CodeRegistry()
    const c = r.issue('k', 0)
    expect(c).toMatch(/^\d{6}$/)
  })

  it('map 超阈值时机会式清过期码（防未消费码累积无界增长）；未过期不误删', () => {
    const r = new CodeRegistry(60_000, 5, 2) // ttl=60s，prune 阈值=2
    r.issue('a', 0)
    r.issue('b', 0)
    expect(r.size).toBe(2)
    // t=70s：a、b 已过期。issue 'c' 使 size 越阈值 → 清掉过期的 a、b，仅留 c。
    r.issue('c', 70_000)
    expect(r.size).toBe(1)
    expect(r.has('c')).toBe(true)
    // 未过期不误删：越阈值但无过期项 → 一个都不删。
    const r2 = new CodeRegistry(60_000, 5, 2)
    r2.issue('x', 0); r2.issue('y', 0); r2.issue('z', 0)
    expect(r2.size).toBe(3)
  })
})
