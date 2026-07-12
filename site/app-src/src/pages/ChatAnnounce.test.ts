import { describe, it, expect } from 'vitest'
import { nextChatAnnouncement, mergeMessagesStable, conversationPreview, needsDateSeparator, dateSeparatorLabel, firstUnreadMessageId, type AnnounceState } from './Chat'
import { isNearBottom } from '../lib/scroll' // 聊天线程与通话内 RTT 共用的"是否贴底"判据
import type { ChatMessage, User } from '../lib/api'

const tzh = (z: string) => z // 默认中文;少参可赋给 (zh,en)=>string,避开 no-unused-vars

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

describe('conversationPreview 会话列表末条发送者前缀', () => {
  const members: User[] = [
    { id: 'me', username: 'me', displayName: '我', role: 'helper', status: 'active' },
    { id: 'p1', username: 'xm', displayName: '小明', role: 'blind', status: 'active' },
  ]
  it('我发的 → "你：" 前缀（一眼分清在等对方回）', () => {
    expect(conversationPreview(msg('4', 'me', '好的'), 'me', tzh)).toBe('你：好的')
  })
  it('单聊对端发的 → 无前缀（行首已显对端名，不赘述）', () => {
    expect(conversationPreview(msg('4', 'p1', '在哪'), 'me', tzh)).toBe('在哪')
  })
  it('群里别人发的 → "{发送者名}：" 前缀（群里知道是谁发的很重要）', () => {
    expect(conversationPreview(msg('4', 'p1', '出发了'), 'me', tzh, members)).toBe('小明：出发了')
  })
  it('群里我发的 → "你："（优先于成员名解析）', () => {
    expect(conversationPreview(msg('4', 'me', '收到'), 'me', tzh, members)).toBe('你：收到')
  })
  it('群里非成员（已退群者的历史末条）→ 无前缀兜底，不崩', () => {
    expect(conversationPreview(msg('4', 'ghost', '旧消息'), 'me', tzh, members)).toBe('旧消息')
  })
  it('我发的图片 → "你：[图片]"（媒体预览也带前缀）', () => {
    const img = { id: '4', fromId: 'me', toId: 'p1', kind: 'image', text: 'mid', createdAt: 4 } as ChatMessage
    expect(conversationPreview(img, 'me', tzh)).toBe('你：[图片]')
  })
  it('撤回消息 → 仅 [已撤回]，不加"你："前缀（读着别扭）', () => {
    const recalled = { id: '5', fromId: 'me', toId: 'p1', kind: 'recalled', text: '', createdAt: 5 } as ChatMessage
    expect(conversationPreview(recalled, 'me', tzh)).toBe('[已撤回]')
  })
  it('无末条 → "暂无消息"', () => {
    expect(conversationPreview(null, 'me', tzh)).toBe('暂无消息')
  })
})

describe('日期分隔（IM 标配：今天/昨天/日期）', () => {
  // 本地正午时间戳：避开时区/夏令时的午夜边界，跨天判定在任何运行时区都确定。
  const noon = (s: string) => Date.parse(`${s}T12:00:00`)
  const now = noon('2026-07-11')

  it('needsDateSeparator：第一条前总插；同本地日不插；跨本地日插', () => {
    expect(needsDateSeparator(now, null)).toBe(true)                     // 第一条
    expect(needsDateSeparator(noon('2026-07-11'), noon('2026-07-11'))).toBe(false) // 同日
    expect(needsDateSeparator(noon('2026-07-11'), noon('2026-07-10'))).toBe(true)  // 跨日
    expect(needsDateSeparator(noon('2026-01-01'), noon('2025-12-31'))).toBe(true)  // 跨年
  })

  it('dateSeparatorLabel：今天/昨天/更早本地化日期（中/英）', () => {
    expect(dateSeparatorLabel(now, now, 'zh')).toBe('今天')
    expect(dateSeparatorLabel(now, now, 'en')).toBe('Today')
    expect(dateSeparatorLabel(noon('2026-07-10'), now, 'zh')).toBe('昨天')
    expect(dateSeparatorLabel(noon('2026-07-10'), now, 'en')).toBe('Yesterday')
    // 更早：本地化长日期（非今天/昨天）。断言含年份、且不是相对词。
    const older = dateSeparatorLabel(noon('2026-07-05'), now, 'zh')
    expect(older).toContain('2026')
    expect(older).not.toBe('今天'); expect(older).not.toBe('昨天')
  })

  it('dateSeparatorLabel：昨天跨月边界（月初的今天 → 昨天是上月末）', () => {
    const firstOfMonth = noon('2026-08-01')
    expect(dateSeparatorLabel(noon('2026-07-31'), firstOfMonth, 'zh')).toBe('昨天') // setDate(-1) 正确回退到 7-31
  })
})

describe('firstUnreadMessageId "新消息"分隔位置（与服务端未读口径一致：非己发∧非撤回）', () => {
  const pm = (id: string, fromId: string, kind: ChatMessage['kind'] = 'text'): ChatMessage =>
    ({ id, fromId, toId: 'me', kind, text: 'x', createdAt: 0 } as ChatMessage)
  it('无未读 → null（不显分隔）', () => {
    expect(firstUnreadMessageId([pm('1', 'p')], 'me', 0)).toBeNull()
  })
  it('未读1 → 末尾第一条对端消息前', () => {
    expect(firstUnreadMessageId([pm('1', 'p'), pm('2', 'me'), pm('3', 'p')], 'me', 1)).toBe('3')
  })
  it('未读2 → 从末尾数第2条对端消息（跳过己发的插入）', () => {
    // [p1, me, p2, me, p3]：对端从末尾数 p3(1)、p2(2) → 分隔落 p2 前
    expect(firstUnreadMessageId([pm('p1', 'p'), pm('m1', 'me'), pm('p2', 'p'), pm('m2', 'me'), pm('p3', 'p')], 'me', 2)).toBe('p2')
  })
  it('撤回消息不计未读、不作分隔位', () => {
    expect(firstUnreadMessageId([pm('p1', 'p'), pm('p2', 'p', 'recalled'), pm('p3', 'p')], 'me', 1)).toBe('p3')
  })
  it('已加载对端消息不足未读数（部分更早未加载）→ 取窗口内最早一条对端消息（分隔落窗口顶）', () => {
    expect(firstUnreadMessageId([pm('m1', 'me'), pm('p1', 'p')], 'me', 3)).toBe('p1')
  })
})

describe('isNearBottom 新消息是否自动滚到底的判据（上翻看历史时别把人硬拽回底部）', () => {
  it('贴着底部（距底 < 阈值）→ true：应随新消息滚到底', () => {
    expect(isNearBottom({ scrollHeight: 1000, scrollTop: 900, clientHeight: 100 })).toBe(true) // 距底 0
    expect(isNearBottom({ scrollHeight: 1000, scrollTop: 850, clientHeight: 100 })).toBe(true) // 距底 50 < 120
  })
  it('上翻在读历史（距底 ≥ 阈值）→ false：不打断阅读、不硬拽回底', () => {
    expect(isNearBottom({ scrollHeight: 1000, scrollTop: 100, clientHeight: 100 })).toBe(false) // 距底 800
    expect(isNearBottom({ scrollHeight: 1000, scrollTop: 780, clientHeight: 100 })).toBe(false) // 距底恰 120，非"<"，判为不贴底（边界）
  })
  it('自定义阈值可放宽/收紧', () => {
    expect(isNearBottom({ scrollHeight: 1000, scrollTop: 100, clientHeight: 100 }, 900)).toBe(true) // 距底 800 < 900
    expect(isNearBottom({ scrollHeight: 1000, scrollTop: 900, clientHeight: 100 }, 0)).toBe(false)  // 距底 0，阈值 0，0<0 假
  })
  it('内容未超容器（未产生滚动，scrollHeight≈clientHeight）→ 视为贴底', () => {
    expect(isNearBottom({ scrollHeight: 100, scrollTop: 0, clientHeight: 100 })).toBe(true) // 距底 0
  })
})
