import { describe, it, expect } from 'vitest'
import { matchBannedTerm, byTimeThenId, beforeCursor, normalizeAppConfig, effectiveFeatures, mergeAppConfig } from '../src/db/store'
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

describe('effectiveFeatures 有效功能开关（覆盖只能 force-off）', () => {
  // normalizeAppConfig 运行时按键读 features（缺键取默认），但类型要求整份 Record，故双断言喂部分键。
  const base = normalizeAppConfig({ features: { calls: true, groups: false } as unknown as AppConfig['features'] })
  it('无覆盖 → 等于全站开关', () => {
    const f = effectiveFeatures(base)
    expect(f.calls).toBe(true)
    expect(f.groups).toBe(false)
  })
  it('override false 关掉全站已开的功能', () => {
    expect(effectiveFeatures(base, { calls: false }).calls).toBe(false)
  })
  it('override true 不能打开全站已关的功能（安全不变量：不能反向提权）', () => {
    expect(effectiveFeatures(base, { groups: true }).groups).toBe(false)
  })
})

describe('mergeAppConfig 逐键合并（PATCH 语义，不整体替换）', () => {
  const base = normalizeAppConfig({ contentFilter: { enabled: false, terms: ['x'] }, features: { calls: true } as unknown as AppConfig['features'] })
  it('只切 contentFilter.enabled 不清空已有 terms', () => {
    const merged = mergeAppConfig(base, { contentFilter: { enabled: true } })
    expect(merged.contentFilter.enabled).toBe(true)
    expect(merged.contentFilter.terms).toEqual(['x'])
  })
  it('未提及的 feature 键保持 base 值，提及的更新', () => {
    const merged = mergeAppConfig(base, { features: { groups: true } })
    expect(merged.features.calls).toBe(true)
    expect(merged.features.groups).toBe(true)
  })
})

describe('normalizeAppConfig 配置消毒（默认值 + 类型强制，防坏配置击穿）', () => {
  it('undefined/null → 安全默认（注册开、免验证、无公告/维护、过滤关）', () => {
    for (const c of [normalizeAppConfig(undefined), normalizeAppConfig(null)]) {
      expect(c.registrationEnabled).toBe(true)
      expect(c.requireVerification).toBe(false)
      expect(c.announcement.active).toBe(false)
      expect(c.maintenance.active).toBe(false)
      expect(c.contentFilter.enabled).toBe(false)
      expect(c.contentFilter.terms).toEqual([])
    }
  })
  it('announcement.level 仅 warning 保留，其余一律归 info', () => {
    expect(normalizeAppConfig({ announcement: { active: true, message: 'x', level: 'warning' } }).announcement.level).toBe('warning')
    expect(normalizeAppConfig({ announcement: { active: true, message: 'x', level: 'bogus' } } as unknown as Partial<AppConfig>).announcement.level).toBe('info')
  })
  it('非字符串 message 归空串（不外泄坏类型到前端）', () => {
    expect(normalizeAppConfig({ announcement: { message: 123 } } as unknown as Partial<AppConfig>).announcement.message).toBe('')
  })
  it('非数组 terms 归 []；数组内非字符串被剔除', () => {
    expect(normalizeAppConfig({ contentFilter: { enabled: true, terms: 'notarray' } } as unknown as Partial<AppConfig>).contentFilter.terms).toEqual([])
    expect(normalizeAppConfig({ contentFilter: { enabled: true, terms: ['a', 123, 'b'] } } as unknown as Partial<AppConfig>).contentFilter.terms).toEqual(['a', 'b'])
  })
  it('非布尔 feature 值被忽略（保持默认，不被坏值污染）', () => {
    const c = normalizeAppConfig({ features: { calls: 'yes' } } as unknown as Partial<AppConfig>)
    expect(typeof c.features.calls).toBe('boolean') // 'yes' 非 boolean → 取默认，不写入字符串
  })
})
