import { describe, it, expect } from 'vitest'
import { nextChatAnnouncement, mergeMessagesStable, type AnnounceState } from './Chat'
import type { ChatMessage } from '../lib/api'

const msg = (id: string, fromId: string, text = 'hi'): ChatMessage =>
  ({ id, fromId, toId: 'me', kind: 'text', text, createdAt: Number(id) } as ChatMessage)
const describe_ = (m: ChatMessage) => `对方：${m.text}`
const fresh: AnnounceState = { id: null, initialized: false }

describe('nextChatAnnouncement 新消息读屏播报决策', () => {
  it('首次（未初始化）：只记录末尾基线、不播报——避免一进会话就念历史最后一条', () => {
    const r = nextChatAnnouncement(msg('3', 'peer'), fresh, 'me', describe_)
    expect(r.text).toBeNull()
    expect(r.state).toEqual({ id: '3', initialized: true })
  })

  it('会话本空的首次加载：记录 id=null、initialized=true，不播报', () => {
    const r = nextChatAnnouncement(null, fresh, 'me', describe_)
    expect(r.text).toBeNull()
    expect(r.state).toEqual({ id: null, initialized: true })
  })

  it('会话进行中收到对端新末尾消息 → 播报', () => {
    const state: AnnounceState = { id: '3', initialized: true }
    const r = nextChatAnnouncement(msg('4', 'peer', '到了吗'), state, 'me', describe_)
    expect(r.text).toBe('对方：到了吗')
    expect(r.state).toEqual({ id: '4', initialized: true })
  })

  it('空会话后对端发来第一条 → 播报（不被"未初始化"规则吞掉）', () => {
    const afterEmpty: AnnounceState = { id: null, initialized: true }
    const r = nextChatAnnouncement(msg('1', 'peer', '你好'), afterEmpty, 'me', describe_)
    expect(r.text).toBe('对方：你好')
    expect(r.state).toEqual({ id: '1', initialized: true })
  })

  it('自己发的新消息不播报（但推进基线，避免其后误播报）', () => {
    const state: AnnounceState = { id: '3', initialized: true }
    const r = nextChatAnnouncement(msg('4', 'me', '在的'), state, 'me', describe_)
    expect(r.text).toBeNull()
    expect(r.state).toEqual({ id: '4', initialized: true })
  })

  it('首次见到即已撤回的消息不播报（与 iOS 同口径，避免念"[已撤回]"噪声）——但推进基线', () => {
    const recalled = { id: '5', fromId: 'peer', toId: 'me', kind: 'recalled', text: '', createdAt: 5 } as ChatMessage
    const state: AnnounceState = { id: '4', initialized: true }
    const r = nextChatAnnouncement(recalled, state, 'me', describe_)
    expect(r.text).toBeNull()
    expect(r.state).toEqual({ id: '5', initialized: true }) // 基线仍前进，后续真消息不被卡住
  })

  it('末尾 id 未变（如上翻"加载更早"只改头部）→ 不播报', () => {
    const state: AnnounceState = { id: '4', initialized: true }
    const r = nextChatAnnouncement(msg('4', 'peer'), state, 'me', describe_)
    expect(r.text).toBeNull()
    expect(r.state).toEqual(state)
  })

  it('轮询到空/无消息时保持状态、不播报', () => {
    const state: AnnounceState = { id: '4', initialized: true }
    const r = nextChatAnnouncement(null, state, 'me', describe_)
    expect(r.text).toBeNull()
    expect(r.state).toEqual(state)
  })
})

describe('mergeMessagesStable 轮询窗口与已加载历史合并', () => {
  it('无已有历史 → 直接返回 fresh（同一引用，避免无谓重排）', () => {
    const fresh = [msg('2', 'peer'), msg('3', 'peer')]
    expect(mergeMessagesStable(fresh, null)).toBe(fresh)
    expect(mergeMessagesStable(fresh, [])).toBe(fresh)
  })

  it('已有历史全在 fresh 中 → 返回 fresh 本身（无 extra，引用稳定）', () => {
    const fresh = [msg('2', 'peer'), msg('3', 'peer')]
    const existing = [msg('3', 'peer')]
    expect(mergeMessagesStable(fresh, existing)).toBe(fresh)
  })

  it('补回不在 fresh 中的更早历史，(createdAt,id) 升序', () => {
    const fresh = [msg('5', 'peer'), msg('6', 'peer')]
    const existing = [msg('1', 'peer'), msg('2', 'peer'), msg('5', 'peer')] // 5 与 fresh 重叠
    const out = mergeMessagesStable(fresh, existing)
    expect(out.map((m) => m.id)).toEqual(['1', '2', '5', '6']) // 1,2 补回；5 不重复
  })

  it('重叠 id 以 fresh 为准（服务器权威）', () => {
    const fresh = [msg('5', 'peer', 'NEW')]
    const existing = [msg('5', 'peer', 'OLD')]
    const out = mergeMessagesStable(fresh, existing)
    expect(out).toHaveLength(1)
    expect(out[0].text).toBe('NEW')
  })

  it('同 createdAt 用 id 决胜，排序稳定确定', () => {
    const a = { id: 'b', fromId: 'peer', toId: 'me', kind: 'text', text: 'x', createdAt: 9 } as ChatMessage
    const b = { id: 'a', fromId: 'peer', toId: 'me', kind: 'text', text: 'y', createdAt: 9 } as ChatMessage
    const out = mergeMessagesStable([a], [b]) // 同 createdAt=9，id a<b
    expect(out.map((m) => m.id)).toEqual(['a', 'b'])
  })
})
