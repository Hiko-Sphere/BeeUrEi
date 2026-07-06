import { describe, it, expect } from 'vitest'
import { buildApp } from '../src/app'
import { MemoryStore } from '../src/db/store'
import { SqliteStore } from '../src/db/sqliteStore'

// 读回执开关（WhatsApp 语义，仅单聊）：关了→不发也不看（互惠）；markRead 照常、未读计数不受影响；群匿名计数不受约束。
const auth = (t: string) => ({ authorization: `Bearer ${t}` })
async function reg(app: ReturnType<typeof buildApp>, u: string, role = 'blind') {
  return (await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: u, password: 'secret123', role } })).json() as { token: string; user: { id: string } }
}
async function bind(app: ReturnType<typeof buildApp>, ownerT: string, memberT: string, memberU: string) {
  await app.inject({ method: 'POST', url: '/api/family/links', headers: auth(ownerT), payload: { username: memberU, relation: '亲友' } })
  const inc = await app.inject({ method: 'GET', url: '/api/family/incoming', headers: auth(memberT) })
  await app.inject({ method: 'POST', url: `/api/family/links/${(inc.json() as any).links[0].id}/accept`, headers: auth(memberT) })
}
async function seed() {
  const app = buildApp(new MemoryStore())
  const a = await reg(app, 'rra', 'blind')
  const b = await reg(app, 'rrb', 'helper')
  await bind(app, a.token, b.token, 'rrb')
  // a 发一条给 b；b 标记已读。
  await app.inject({ method: 'POST', url: '/api/messages', headers: auth(a.token), payload: { toId: b.user.id, kind: 'text', text: '在吗' } })
  await app.inject({ method: 'POST', url: '/api/messages/read', headers: auth(b.token), payload: { fromId: a.user.id } })
  const myMsgs = async () => ((await app.inject({ method: 'GET', url: `/api/messages?with=${b.user.id}`, headers: auth(a.token) })).json() as any).messages as { fromId: string; readAt?: number }[]
  return { app, a, b, myMsgs }
}

describe('读回执开关 /api/account/read-receipts', () => {
  it('默认开：selfView.readReceiptsEnabled=true；关掉→持久化并反映到 /api/me', async () => {
    const { app, a } = await seed()
    expect(((await app.inject({ method: 'GET', url: '/api/me', headers: auth(a.token) })).json() as any).user.readReceiptsEnabled).toBe(true)
    const r = await app.inject({ method: 'POST', url: '/api/account/read-receipts', headers: auth(a.token), payload: { enabled: false } })
    expect(r.statusCode).toBe(200)
    expect((r.json() as any).readReceiptsEnabled).toBe(false)
    expect(((await app.inject({ method: 'GET', url: '/api/me', headers: auth(a.token) })).json() as any).user.readReceiptsEnabled).toBe(false)
    await app.close()
  })

  it('两端都开（默认）：发送方看得到 readAt（既有行为不回归）', async () => {
    const { app, myMsgs } = await seed()
    expect((await myMsgs())[0].readAt).toBeTruthy()
    await app.close()
  })

  it('接收方关闭 → 发送方看不到 readAt（消息列表与会话列表 last 都不带）；未读计数不受影响', async () => {
    const { app, a, b, myMsgs } = await seed()
    await app.inject({ method: 'POST', url: '/api/account/read-receipts', headers: auth(b.token), payload: { enabled: false } })
    expect((await myMsgs())[0].readAt).toBeUndefined() // 已读时刻不再暴露给发送方
    // 会话列表的 last 同口径不带。
    const convos = ((await app.inject({ method: 'GET', url: '/api/conversations', headers: auth(a.token) })).json() as any).conversations
    expect(convos[0].last.readAt).toBeUndefined()
    // 未读计数完全不受影响：b 已读过 → b 的该会话未读为 0（markRead 照常写库）。
    const bConvos = ((await app.inject({ method: 'GET', url: '/api/conversations', headers: auth(b.token) })).json() as any).conversations
    expect(bConvos[0].unread).toBe(0)
    await app.close()
  })

  it('互惠：发送方自己关闭 → 也看不到对方的已读（即使对方开着）', async () => {
    const { app, a, myMsgs } = await seed()
    await app.inject({ method: 'POST', url: '/api/account/read-receipts', headers: auth(a.token), payload: { enabled: false } })
    expect((await myMsgs())[0].readAt).toBeUndefined()
    await app.close()
  })

  it('群回执（匿名计数 readBy/readTotal）不受本开关约束（WhatsApp 群例外）', async () => {
    const { app, a, b } = await seed()
    await app.inject({ method: 'POST', url: '/api/account/read-receipts', headers: auth(b.token), payload: { enabled: false } })
    const g = await app.inject({ method: 'POST', url: '/api/groups', headers: auth(a.token), payload: { name: '回执群', memberIds: [b.user.id] } })
    const gid = (g.json() as any).group.id as string
    await app.inject({ method: 'POST', url: '/api/messages', headers: auth(a.token), payload: { groupId: gid, text: '群里喊一声' } })
    await app.inject({ method: 'POST', url: '/api/messages/read', headers: auth(b.token), payload: { groupId: gid } })
    const msgs = ((await app.inject({ method: 'GET', url: `/api/messages?group=${gid}`, headers: auth(a.token) })).json() as any).messages
    const mine = msgs.find((m: any) => m.text === '群里喊一声')
    expect(mine.readTotal).toBe(1) // 匿名计数照常（不点名谁读了，本就无隐私暴露）
    expect(mine.readBy).toBe(1)
    await app.close()
  })

  it('SqliteStore 列往返：显式 false 存取一致；未设置保持 undefined（缺省=开）', () => {
    const s = new SqliteStore(':memory:')
    s.createUser({ id: 'u1', username: 'rr1', passwordHash: 'h', displayName: 'rr1', role: 'blind', status: 'active', createdAt: 1, readReceiptsEnabled: false })
    s.createUser({ id: 'u2', username: 'rr2', passwordHash: 'h', displayName: 'rr2', role: 'blind', status: 'active', createdAt: 1 })
    expect(s.findById('u1')?.readReceiptsEnabled).toBe(false)
    expect(s.findById('u2')?.readReceiptsEnabled).toBeUndefined()
    // updateUser 路径（经 createUser INSERT OR REPLACE）同样持久。
    s.updateUser('u2', { readReceiptsEnabled: false })
    expect(s.findById('u2')?.readReceiptsEnabled).toBe(false)
  })
})
