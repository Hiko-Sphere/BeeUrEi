import { describe, it, expect } from 'vitest'
import { nextChatAnnouncement, type AnnounceState } from './Chat'
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
