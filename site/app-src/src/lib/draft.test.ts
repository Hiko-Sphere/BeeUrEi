// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from 'vitest'
import { draftKey, draftPreview } from './draft'

describe('draft 会话草稿（键单一事实源 + 列表预览读取）', () => {
  beforeEach(() => localStorage.clear())

  it('draftKey：按 用户+会话 命名空间；无用户回落 anon（与 Thread 写入端同格式）', () => {
    expect(draftKey('me', 'peer', 'p1')).toBe('beeurei:draft:me:peer:p1')
    expect(draftKey('me', 'group', 'g1')).toBe('beeurei:draft:me:group:g1')
    expect(draftKey(undefined, 'peer', 'p1')).toBe('beeurei:draft:anon:peer:p1')
  })

  it('draftPreview：有草稿→原文；纯空白/缺失→null（列表不标空草稿）；换用户互不串读', () => {
    localStorage.setItem('beeurei:draft:me:peer:p1', '还没发完的话')
    expect(draftPreview('me', 'peer', 'p1')).toBe('还没发完的话')
    localStorage.setItem('beeurei:draft:me:peer:p2', '   ')
    expect(draftPreview('me', 'peer', 'p2')).toBeNull()   // 纯空白不算草稿
    expect(draftPreview('me', 'peer', 'p3')).toBeNull()   // 无草稿
    expect(draftPreview('other', 'peer', 'p1')).toBeNull() // 换账号不串读（隐私）
  })
})
