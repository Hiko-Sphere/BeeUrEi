import { describe, it, expect } from 'vitest'
import { matchBannedTerm, byTimeThenId, beforeCursor, normalizeAppConfig } from '../src/db/store'
import type { AppConfig, ChatMessage } from '../src/db/store'

const cfg = (enabled: boolean, terms: string[]): AppConfig =>
  normalizeAppConfig({ contentFilter: { enabled, terms } } as Partial<AppConfig>)
const m = (id: string, createdAt: number): ChatMessage =>
  ({ id, fromId: 'a', toId: 'b', kind: 'text', text: '', createdAt } as ChatMessage)

describe('matchBannedTerm 内容过滤', () => {
  it('关闭 / 无词 / 空文本 → null', () => {
    expect(matchBannedTerm(cfg(false, ['坏']), '这是坏话')).toBeNull()
    expect(matchBannedTerm(cfg(true, []), '这是坏话')).toBeNull()
    expect(matchBannedTerm(cfg(true, ['坏']), '')).toBeNull()
  })
  it('大小写不敏感子串命中，返回原词（含中英）', () => {
    expect(matchBannedTerm(cfg(true, ['BadWord']), 'this is a badword here')).toBe('BadWord')
    expect(matchBannedTerm(cfg(true, ['坏话']), '你说了坏话啊')).toBe('坏话')
  })
  it('空/纯空白词被跳过，不误命中一切文本', () => {
    expect(matchBannedTerm(cfg(true, ['  ', '']), '任意文本')).toBeNull()
  })
  it('词首尾空白被 trim 后再匹配（配置容错）', () => {
    expect(matchBannedTerm(cfg(true, ['  spam  ']), 'contains spam yes')).toBe('  spam  ')
  })
  it('未命中 → null', () => {
    expect(matchBannedTerm(cfg(true, ['坏']), '一切正常')).toBeNull()
  })
})

describe('byTimeThenId 稳定全序 (createdAt,id)', () => {
  it('按 createdAt 升序', () => {
    expect(byTimeThenId(m('x', 1), m('y', 2))).toBeLessThan(0)
    expect(byTimeThenId(m('x', 3), m('y', 2))).toBeGreaterThan(0)
  })
  it('同 createdAt 用 id 字典序决胜，相等返回 0', () => {
    expect(byTimeThenId(m('a', 5), m('b', 5))).toBeLessThan(0)
    expect(byTimeThenId(m('b', 5), m('a', 5))).toBeGreaterThan(0)
    expect(byTimeThenId(m('a', 5), m('a', 5))).toBe(0)
  })
})

describe('beforeCursor 复合游标（keyset 分页，防漏/重）', () => {
  it('无游标 → 全取', () => {
    expect(beforeCursor(m('x', 100))).toBe(true)
  })
  it('严格更早时间 → true', () => {
    expect(beforeCursor(m('x', 99), 100, 'zzz')).toBe(true)
  })
  it('同时间、id 更小 → true', () => {
    expect(beforeCursor(m('aaa', 100), 100, 'bbb')).toBe(true)
  })
  it('同时间、id 相等（游标本身）→ false（不重复包含游标）', () => {
    expect(beforeCursor(m('bbb', 100), 100, 'bbb')).toBe(false)
  })
  it('同时间、id 更大 → false', () => {
    expect(beforeCursor(m('ccc', 100), 100, 'bbb')).toBe(false)
  })
  it('缺 beforeId（旧客户端）→ 退回严格 createdAt<beforeMs：同毫秒不含、更早含', () => {
    expect(beforeCursor(m('x', 100), 100)).toBe(false)
    expect(beforeCursor(m('x', 99), 100)).toBe(true)
  })
})
