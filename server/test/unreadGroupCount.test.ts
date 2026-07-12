import { describe, it, expect } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MemoryStore, type ChatMessage } from '../src/db/store'
import { SqliteStore } from '../src/db/sqliteStore'
import { totalUnreadFor } from '../src/db/unread'

// 群未读高效精确计数（角标数据源）。以前的实现「取最近 200 条消息体再 filter」在两处失真：
// ① >200 条未读时封顶漏计（角标少报）；② 每次算角标都载 200 条完整消息体（性能足印）。
// unreadGroupCount 用无上限 COUNT 取代之。
function gmsg(groupId: string, fromId: string, createdAt: number, kind: ChatMessage['kind'] = 'text'): ChatMessage {
  return { id: `${groupId}-${fromId}-${createdAt}`, fromId, toId: '', groupId, kind, text: 't', createdAt }
}

describe('unreadGroupCount：无上限精确群未读', () => {
  it('createdAt>已读时刻、非己发、非撤回；已读游标推进即减少', () => {
    const s = new MemoryStore()
    s.createGroup({ id: 'g', name: 'G', ownerId: 'u1', memberIds: ['u1', 'u2'], createdAt: 0 })
    for (let i = 1; i <= 5; i++) s.createMessage(gmsg('g', 'u2', i)) // u2 发 5 条
    s.createMessage(gmsg('g', 'u1', 6))                              // u1 自己发的不计
    s.createMessage(gmsg('g', 'u2', 7, 'recalled'))                  // 撤回不计
    expect(s.unreadGroupCount('g', 'u1')).toBe(5)                    // 5 条 u2 文本（自发+撤回排除）
    s.setGroupRead('g', 'u1', 3)                                     // 读到 t=3
    expect(s.unreadGroupCount('g', 'u1')).toBe(2)                    // 只剩 t=4,5（>3）
    expect(s.unreadGroupCount('g', 'u2')).toBe(1)                    // 对 u2 而言：仅 u1 在 t=6 发的那条
  })

  it('回归：>200 条未读不再被封顶到 200（旧的"取最近 200 条 filter"会漏计）', () => {
    const s = new MemoryStore()
    s.createGroup({ id: 'g', name: 'G', ownerId: 'u1', memberIds: ['u1', 'u2'], createdAt: 0 })
    for (let i = 1; i <= 250; i++) s.createMessage(gmsg('g', 'u2', i)) // u2 发 250 条，u1 一条没读
    expect(s.unreadGroupCount('g', 'u1')).toBe(250)                   // 精确 250，不是封顶的 200
    expect(totalUnreadFor(s, 'u1').messages).toBe(250)               // 汇总也精确
  })

  it('totalUnreadFor 合并单聊+群+通知；群部分走 unreadGroupCount', () => {
    const s = new MemoryStore()
    s.createGroup({ id: 'g', name: 'G', ownerId: 'u1', memberIds: ['u1', 'u2'], createdAt: 0 })
    for (let i = 1; i <= 3; i++) s.createMessage(gmsg('g', 'u2', i))
    // 单聊 u3→u1 两条未读
    s.createMessage({ id: 'd1', fromId: 'u3', toId: 'u1', kind: 'text', text: 'x', createdAt: 10 })
    s.createMessage({ id: 'd2', fromId: 'u3', toId: 'u1', kind: 'text', text: 'y', createdAt: 11 })
    const r = totalUnreadFor(s, 'u1')
    expect(r.messages).toBe(5) // 群 3 + 单聊 2
  })

  it('静音会话不计入全局角标（WhatsApp 口径）：静音群/单聊的未读被排除，解除静音即恢复计入', () => {
    const s = new MemoryStore()
    // 群 3 条未读 + 单聊 u3→u1 两条未读。
    s.createGroup({ id: 'g', name: 'G', ownerId: 'u1', memberIds: ['u1', 'u2'], createdAt: 0 })
    for (let i = 1; i <= 3; i++) s.createMessage(gmsg('g', 'u2', i))
    s.createMessage({ id: 'd1', fromId: 'u3', toId: 'u1', kind: 'text', text: 'x', createdAt: 10 })
    s.createMessage({ id: 'd2', fromId: 'u3', toId: 'u1', kind: 'text', text: 'y', createdAt: 11 })
    expect(totalUnreadFor(s, 'u1').messages).toBe(5)
    // 静音群 → 群 3 条不再顶角标（列表行内未读另有端点、不受影响）。
    s.setGroupMuted('g', 'u1', true)
    expect(totalUnreadFor(s, 'u1').messages).toBe(2)
    // 再静音单聊 → 角标归零（用户明示"都别要我注意"）。
    s.setDmMuted('u1', 'u3', true)
    expect(totalUnreadFor(s, 'u1').messages).toBe(0)
    // 解除静音 → 恢复计入（未读并没有被清掉，只是不进角标）。
    s.setGroupMuted('g', 'u1', false)
    s.setDmMuted('u1', 'u3', false)
    expect(totalUnreadFor(s, 'u1').messages).toBe(5)
    // 静音是有向的：u3 静音自己与 u1 的会话，不影响 u1 的角标。
    s.setDmMuted('u3', 'u1', true)
    expect(totalUnreadFor(s, 'u1').messages).toBe(5)
  })

  it('totalUnreadFor.total = 单聊 + 群 + 通知 + 未接来电 四源精确相加（全站角标总口径：漏一源/重复计立失败）', () => {
    const s = new MemoryStore()
    // 单聊 u3→u1 两条未读
    s.createMessage({ id: 'd1', fromId: 'u3', toId: 'u1', kind: 'text', text: 'a', createdAt: 10 })
    s.createMessage({ id: 'd2', fromId: 'u3', toId: 'u1', kind: 'text', text: 'b', createdAt: 11 })
    // 群 3 条未读
    s.createGroup({ id: 'g', name: 'G', ownerId: 'u1', memberIds: ['u1', 'u2'], createdAt: 0 })
    for (let i = 1; i <= 3; i++) s.createMessage(gmsg('g', 'u2', i))
    // 铃铛通知 4 条未读
    for (let i = 0; i < 4; i++) s.createNotification({ id: `n${i}`, userId: 'u1', kind: 'friend_request', title: 't', body: 'b', createdAt: 100 + i })
    // 未接来电 1 条（u1 被叫、status=missed、createdAt > callHistorySeenAt；u1 未建号→seen=0 故计入）
    s.createCallRecord({ id: 'c1', callId: 'call1', callerId: 'u3', calleeId: 'u1', status: 'missed', createdAt: 200 })
    const r = totalUnreadFor(s, 'u1')
    expect(r.messages).toBe(5)       // 单聊 2 + 群 3
    expect(r.notifications).toBe(4)
    expect(r.missedCalls).toBe(1)
    expect(r.total).toBe(10)         // 5+4+1 —— total 必须是四源精确相加；此前测试只验了 messages 支
  })

  it('SqliteStore 与 MemoryStore 同口径（SQL COUNT 真跑一遍，含游标/己发/撤回/>200）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'beeurei-unread-'))
    try {
      const s = new SqliteStore(join(dir, 'u.db'))
      s.createGroup({ id: 'g', name: 'G', ownerId: 'u1', memberIds: ['u1', 'u2'], createdAt: 0 })
      for (let i = 1; i <= 250; i++) s.createMessage(gmsg('g', 'u2', i))
      s.createMessage(gmsg('g', 'u1', 251))          // 己发不计
      s.createMessage(gmsg('g', 'u2', 252, 'recalled')) // 撤回不计
      expect(s.unreadGroupCount('g', 'u1')).toBe(250) // >200 精确、排除己发/撤回
      s.setGroupRead('g', 'u1', 100)
      expect(s.unreadGroupCount('g', 'u1')).toBe(150) // 只剩 t=101..250
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
