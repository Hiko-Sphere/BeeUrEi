import { describe, it, expect } from 'vitest'
import { buildApp } from '../src/app'
import { MemoryStore, JsonFileStore, aggregateReactions, type ChatMessage, type Store } from '../src/db/store'
import { SqliteStore } from '../src/db/sqliteStore'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rmSync } from 'node:fs'

// 逐用户表情回应（per-user reactions）：每人对一条消息至多一个 emoji；聚合成 [{emoji,count,mine}]。
// 与旧单字段 message.reaction 并行 dual-write，旧客户端行为不变。

describe('aggregateReactions 纯聚合（按 emoji 计数 + 我是否也回应 + 回应者名单，首现序稳定）', () => {
  const nameOf = (uid: string) => ({ a: '甲', b: '乙', c: '丙' } as Record<string, string>)[uid] ?? '—'
  it('同 emoji 计数、不同 emoji 各一项、mine 按 viewer、names 保留回应者出现序', () => {
    const rows = [{ userId: 'a', emoji: '👍' }, { userId: 'b', emoji: '👍' }, { userId: 'c', emoji: '❤️' }]
    expect(aggregateReactions(rows, 'a', nameOf)).toEqual([{ emoji: '👍', count: 2, mine: true, names: ['甲', '乙'] }, { emoji: '❤️', count: 1, mine: false, names: ['丙'] }])
    expect(aggregateReactions(rows, 'c', nameOf)).toEqual([{ emoji: '👍', count: 2, mine: false, names: ['甲', '乙'] }, { emoji: '❤️', count: 1, mine: true, names: ['丙'] }])
    expect(aggregateReactions(rows, 'z', nameOf).every((r) => !r.mine)).toBe(true) // 非参与者：全 mine=false
  })
  it('首现序稳定（先出现的 emoji 排前，与插入序无关于 count）', () => {
    const rows = [{ userId: 'a', emoji: '😀' }, { userId: 'b', emoji: '🎉' }, { userId: 'c', emoji: '😀' }]
    expect(aggregateReactions(rows, 'x', nameOf).map((r) => r.emoji)).toEqual(['😀', '🎉']) // 😀 先出现
  })
  it('空 → 空数组', () => { expect(aggregateReactions([], 'a', nameOf)).toEqual([]) })
})

const gmsg = (id: string, groupId: string, fromId = 'u1'): ChatMessage =>
  ({ id, fromId, toId: '', groupId, kind: 'text', text: 'hi', createdAt: Number(id.replace(/\D/g, '')) || 1 } as ChatMessage)

describe('setMessageReaction / messageReactionsFor 两 store 一致', () => {
  for (const [label, make] of [['MemoryStore', () => new MemoryStore()], ['SqliteStore', () => new SqliteStore(':memory:')]] as [string, () => Store][]) {
    it(`${label}: 逐用户 upsert/取消 + 批量取 + dual-write 单字段 + 不串消息`, () => {
      const s = make()
      s.createMessage(gmsg('m1', 'g1'))
      s.createMessage(gmsg('m2', 'g1'))
      s.setMessageReaction('m1', 'a', '👍')
      s.setMessageReaction('m1', 'b', '❤️')
      s.setMessageReaction('m1', 'a', '🎉') // a 改主意：覆盖自己的（每人至多一个）
      const r = s.messageReactionsFor(['m1', 'm2'])
      expect(new Set(r.get('m1')!.map((x) => `${x.userId}:${x.emoji}`))).toEqual(new Set(['a:🎉', 'b:❤️'])) // a 是 🎉 不是 👍
      expect(r.has('m2')).toBe(false) // 不串消息
      // dual-write：旧单字段 = 最近一次所设（a 的 🎉），旧客户端仍读得到"一个表情"。
      expect(s.findMessage('m1')!.reaction).toBe('🎉')
      // a 取消自己的（emoji=''）→ 只剩 b 的 ❤️；单字段回落到某现存表情。
      s.setMessageReaction('m1', 'a', '')
      expect(s.messageReactionsFor(['m1']).get('m1')!.map((x) => x.userId)).toEqual(['b'])
      expect(s.findMessage('m1')!.reaction).toBe('❤️')
      // b 也取消 → 全空；单字段清空。
      s.setMessageReaction('m1', 'b', '')
      expect(s.messageReactionsFor(['m1']).has('m1')).toBe(false)
      expect(s.findMessage('m1')!.reaction).toBeUndefined()
    })

    it(`${label}: deleteMessageReactions（撤回）与 deleteMessageReactionsByUser（删号）`, () => {
      const s = make()
      s.createMessage(gmsg('m1', 'g1')); s.createMessage(gmsg('m2', 'g1'))
      s.setMessageReaction('m1', 'a', '👍'); s.setMessageReaction('m2', 'a', '👍'); s.setMessageReaction('m1', 'b', '❤️')
      s.deleteMessageReactions('m1') // 撤回 m1 → m1 全清、m2 不动
      expect(s.messageReactionsFor(['m1']).has('m1')).toBe(false)
      expect(s.messageReactionsFor(['m2']).get('m2')!.length).toBe(1)
      s.deleteMessageReactionsByUser('a') // 删号 a → 抹掉 a 在各处的表情（m2 的 a:👍 没了）
      expect(s.messageReactionsFor(['m2']).has('m2')).toBe(false)
    })
  }
})

describe('JsonFileStore 持久化：逐用户表情回应存盘后重载不丢', () => {
  it('setMessageReaction → 落盘 → 新实例载盘，reactions 完整还原（含多用户多消息）', () => {
    const path = join(tmpdir(), `beeurei-react-${randomUUID()}.json`)
    try {
      const s1 = new JsonFileStore(path)
      s1.createMessage(gmsg('m1', 'g1')); s1.createMessage(gmsg('m2', 'g1'))
      s1.setMessageReaction('m1', 'a', '👍'); s1.setMessageReaction('m1', 'b', '❤️'); s1.setMessageReaction('m2', 'a', '🎉')
      // 从同一文件全新载入（模拟进程重启）。
      const s2 = new JsonFileStore(path)
      const r = s2.messageReactionsFor(['m1', 'm2'])
      expect(new Set(r.get('m1')!.map((x) => `${x.userId}:${x.emoji}`))).toEqual(new Set(['a:👍', 'b:❤️']))
      expect(r.get('m2')).toEqual([{ userId: 'a', emoji: '🎉' }])
      expect(s2.findMessage('m1')!.reaction).toBeTruthy() // 单字段也随消息持久化
    } finally { rmSync(path, { force: true }) }
  })
})

describe('POST /api/messages/:id/reaction 端到端（逐用户 + mine 按 viewer + dual-write）', () => {
  async function seed() {
    const store = new MemoryStore()
    const a = buildApp(store)
    const reg = async (u: string, role = 'helper') => (await a.inject({ method: 'POST', url: '/api/auth/register', payload: { username: u, password: 'secret123', role, displayName: u } })).json()
    const A = await reg('rxA'); const B = await reg('rxB', 'blind')
    // 建互相绑定（accepted）以满足单聊可达性。
    const link = (await a.inject({ method: 'POST', url: '/api/family/links', headers: { authorization: `Bearer ${A.token}` }, payload: { username: 'rxB', relation: '家人', isEmergency: false } })).json()
    await a.inject({ method: 'POST', url: `/api/family/links/${link.link.id}/accept`, headers: { authorization: `Bearer ${B.token}` } })
    const sent = (await a.inject({ method: 'POST', url: '/api/messages', headers: { authorization: `Bearer ${A.token}` }, payload: { toId: B.user.id, kind: 'text', text: '在吗' } })).json()
    return { a, store, A, B, mid: sent.message.id as string }
  }
  const auth = (t: string) => ({ authorization: `Bearer ${t}` })

  it('A、B 各回应不同 emoji → GET 消息见两项，mine 各自视角正确；旧单字段被 dual-write', async () => {
    const { a, store, A, B, mid } = await seed()
    expect((await a.inject({ method: 'POST', url: `/api/messages/${mid}/reaction`, headers: auth(A.token), payload: { emoji: '👍' } })).statusCode).toBe(200)
    expect((await a.inject({ method: 'POST', url: `/api/messages/${mid}/reaction`, headers: auth(B.token), payload: { emoji: '❤️' } })).statusCode).toBe(200)
    // A 视角
    const asA = (await a.inject({ method: 'GET', url: `/api/messages?with=${B.user.id}`, headers: auth(A.token) })).json().messages
    const mA = asA.find((m: { id: string }) => m.id === mid)
    expect(mA.reactions).toEqual([{ emoji: '👍', count: 1, mine: true, names: ['rxA'] }, { emoji: '❤️', count: 1, mine: false, names: ['rxB'] }])
    // B 视角：mine 翻转
    const asB = (await a.inject({ method: 'GET', url: `/api/messages?with=${A.user.id}`, headers: auth(B.token) })).json().messages
    const mB = asB.find((m: { id: string }) => m.id === mid)
    expect(mB.reactions).toEqual([{ emoji: '👍', count: 1, mine: false, names: ['rxA'] }, { emoji: '❤️', count: 1, mine: true, names: ['rxB'] }])
    // 旧单字段仍在（旧客户端兼容）
    expect(store.findMessage(mid)!.reaction).toBeTruthy()
    await a.close()
  })

  it('取消（emoji=空）→ 该项消失；撤回消息 → reactions 全清且不再返回', async () => {
    const { a, A, B, mid } = await seed()
    await a.inject({ method: 'POST', url: `/api/messages/${mid}/reaction`, headers: auth(A.token), payload: { emoji: '👍' } })
    await a.inject({ method: 'POST', url: `/api/messages/${mid}/reaction`, headers: auth(B.token), payload: { emoji: '❤️' } })
    // A 取消自己的
    const resp = (await a.inject({ method: 'POST', url: `/api/messages/${mid}/reaction`, headers: auth(A.token), payload: { emoji: '' } })).json()
    expect(resp.message.reactions).toEqual([{ emoji: '❤️', count: 1, mine: false, names: ['rxB'] }]) // 只剩 B 的（A 视角 mine=false）
    // A 撤回（A 是发送者、2 分钟内）→ reactions 清空
    await a.inject({ method: 'POST', url: `/api/messages/${mid}/recall`, headers: auth(A.token) })
    const after = (await a.inject({ method: 'GET', url: `/api/messages?with=${B.user.id}`, headers: auth(A.token) })).json().messages
    const m = after.find((x: { id: string }) => x.id === mid)
    expect(m.kind).toBe('recalled')
    expect(m.reactions).toBeUndefined() // 撤回消息不带 reactions
    await a.close()
  })

  it('编辑消息的回显也带 reactions（编辑不动表情；写操作回显与列表同口径，别把胶囊清空）', async () => {
    const { a, A, B, mid } = await seed()
    await a.inject({ method: 'POST', url: `/api/messages/${mid}/reaction`, headers: auth(B.token), payload: { emoji: '👍' } })
    // A 编辑自己发的这条（15 分钟内、text 类）→ 回显须仍带 B 的 👍。
    const edited = (await a.inject({ method: 'POST', url: `/api/messages/${mid}/edit`, headers: auth(A.token), payload: { text: '在的' } })).json()
    expect(edited.message.text).toBe('在的')
    expect(edited.message.editedAt).toBeTruthy()
    expect(edited.message.reactions).toEqual([{ emoji: '👍', count: 1, mine: false, names: ['rxB'] }]) // A 视角：B 的 👍，mine=false，未被编辑清空
    await a.close()
  })

  it('**群消息**同样带 reactions（各成员回应各显、mine 按视角）——GET ?group= 分支不漏（姊妹分支护栏）', async () => {
    const store = new MemoryStore()
    const a = buildApp(store)
    const reg = async (u: string) => (await a.inject({ method: 'POST', url: '/api/auth/register', payload: { username: u, password: 'secret123', role: 'helper', displayName: u } })).json()
    const owner = await reg('rgOwner'); const m1 = await reg('rgM1'); const m2 = await reg('rgM2')
    // owner 与两成员互绑（建群要求成员是群主好友）。
    for (const [who, uname] of [[m1, 'rgM1'], [m2, 'rgM2']] as const) {
      const l = (await a.inject({ method: 'POST', url: '/api/family/links', headers: { authorization: `Bearer ${owner.token}` }, payload: { username: uname, relation: '家人', isEmergency: false } })).json()
      await a.inject({ method: 'POST', url: `/api/family/links/${l.link.id}/accept`, headers: { authorization: `Bearer ${who.token}` } })
    }
    const grp = (await a.inject({ method: 'POST', url: '/api/groups', headers: { authorization: `Bearer ${owner.token}` }, payload: { name: '家庭群', memberIds: [m1.user.id, m2.user.id] } })).json().group
    const sent = (await a.inject({ method: 'POST', url: '/api/messages', headers: { authorization: `Bearer ${owner.token}` }, payload: { groupId: grp.id, kind: 'text', text: '大家好' } })).json().message
    // 两成员各回应不同 emoji（群里就是要各显、不互顶）。
    await a.inject({ method: 'POST', url: `/api/messages/${sent.id}/reaction`, headers: { authorization: `Bearer ${m1.token}` }, payload: { emoji: '👍' } })
    await a.inject({ method: 'POST', url: `/api/messages/${sent.id}/reaction`, headers: { authorization: `Bearer ${m2.token}` }, payload: { emoji: '🎉' } })
    // 群消息 GET（?group=）必须带 reactions（此前只单聊分支带、群分支漏）。m1 视角：👍 是我的。
    const asM1 = (await a.inject({ method: 'GET', url: `/api/messages?group=${grp.id}`, headers: { authorization: `Bearer ${m1.token}` } })).json().messages
    const mm = asM1.find((x: { id: string }) => x.id === sent.id)
    expect(mm.reactions).toEqual([{ emoji: '👍', count: 1, mine: true, names: ['rgM1'] }, { emoji: '🎉', count: 1, mine: false, names: ['rgM2'] }])
    await a.close()
  })
})
