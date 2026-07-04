import { describe, it, expect } from 'vitest'
import { buildApp } from '../src/app'
import { MemoryStore } from '../src/db/store'

const auth = (t: string) => ({ authorization: `Bearer ${t}` })
async function reg(app: ReturnType<typeof buildApp>, u: string, role = 'blind') {
  return (await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: u, password: 'secret123', role } })).json() as { token: string; user: { id: string } }
}
async function bind(app: ReturnType<typeof buildApp>, ownerT: string, memberT: string, memberU: string) {
  await app.inject({ method: 'POST', url: '/api/family/links', headers: auth(ownerT), payload: { username: memberU, relation: '亲友' } })
  const inc = await app.inject({ method: 'GET', url: '/api/family/incoming', headers: auth(memberT) })
  const id = (inc.json() as any).links[0].id as string
  await app.inject({ method: 'POST', url: `/api/family/links/${id}/accept`, headers: auth(memberT) })
}
async function groupMessages(app: ReturnType<typeof buildApp>, token: string, gid: string) {
  return (await app.inject({ method: 'GET', url: `/api/messages?group=${gid}`, headers: auth(token) })).json().messages as any[]
}

describe('群已读回执 GET /api/messages?group', () => {
  it('自己发的群消息附「已读 N/其他成员数」；成员逐个已读后计数递增', async () => {
    const store = new MemoryStore()
    const app = buildApp(store)
    const a = await reg(app, 'grca', 'blind')
    const b = await reg(app, 'grcb', 'helper')
    const c = await reg(app, 'grcc', 'helper')
    await bind(app, a.token, b.token, 'grcb')
    await bind(app, a.token, c.token, 'grcc')
    const grp = await app.inject({ method: 'POST', url: '/api/groups', headers: auth(a.token), payload: { name: '一家人', memberIds: [b.user.id, c.user.id] } })
    const gid = (grp.json() as any).group.id as string
    const sent = await app.inject({ method: 'POST', url: '/api/messages', headers: auth(a.token), payload: { groupId: gid, kind: 'text', text: '五点见' } })
    const mid = (sent.json() as any).message.id as string

    // 初始：b、c 都未读 → readBy 0，readTotal 2（除群主外 2 人）。
    let mine = (await groupMessages(app, a.token, gid)).find((m) => m.id === mid)
    expect(mine).toMatchObject({ readBy: 0, readTotal: 2 })

    // b 读 → readBy 1。
    await app.inject({ method: 'POST', url: '/api/messages/read', headers: auth(b.token), payload: { groupId: gid } })
    mine = (await groupMessages(app, a.token, gid)).find((m) => m.id === mid)
    expect(mine).toMatchObject({ readBy: 1, readTotal: 2 })

    // c 也读 → readBy 2（全员已读）。
    await app.inject({ method: 'POST', url: '/api/messages/read', headers: auth(c.token), payload: { groupId: gid } })
    mine = (await groupMessages(app, a.token, gid)).find((m) => m.id === mid)
    expect(mine).toMatchObject({ readBy: 2, readTotal: 2 })
  })

  it('只对发送者暴露回执：其他成员看该条消息无 readBy（不泄漏他人已读状态）；撤回的消息不带回执', async () => {
    const store = new MemoryStore()
    const app = buildApp(store)
    const a = await reg(app, 'grda', 'blind')
    const b = await reg(app, 'grdb', 'helper')
    await bind(app, a.token, b.token, 'grdb')
    const grp = await app.inject({ method: 'POST', url: '/api/groups', headers: auth(a.token), payload: { name: '两人组', memberIds: [b.user.id] } })
    const gid = (grp.json() as any).group.id as string
    const sent = await app.inject({ method: 'POST', url: '/api/messages', headers: auth(a.token), payload: { groupId: gid, kind: 'text', text: '在吗' } })
    const mid = (sent.json() as any).message.id as string

    // b（非发送者）拉取：a 的消息不带 readBy（回执只对发送者可见）。
    const bView = (await groupMessages(app, b.token, gid)).find((m) => m.id === mid)
    expect(bView.readBy).toBeUndefined()
    expect(bView.readTotal).toBeUndefined()

    // a 撤回后再看：撤回消息不带回执。
    await app.inject({ method: 'POST', url: `/api/messages/${mid}/recall`, headers: auth(a.token) })
    const recalled = (await groupMessages(app, a.token, gid)).find((m) => m.id === mid)
    expect(recalled.kind).toBe('recalled')
    expect(recalled.readBy).toBeUndefined()
    await app.close()
  })
})
