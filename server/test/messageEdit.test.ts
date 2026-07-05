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

describe('消息编辑 /api/messages/:id/edit', () => {
  async function seed() {
    const store = new MemoryStore()
    const app = buildApp(store)
    const a = await reg(app, 'edita', 'blind')
    const b = await reg(app, 'editb', 'helper')
    await bind(app, a.token, b.token, 'editb')
    const sent = await app.inject({ method: 'POST', url: '/api/messages', headers: auth(a.token), payload: { toId: b.user.id, kind: 'text', text: 'helo wrold' } })
    const mid = (sent.json() as any).message.id as string
    return { app, store, a, b, mid }
  }

  it('作者可编辑自己的文字消息：改内容 + 标 editedAt', async () => {
    const { app, a, mid } = await seed()
    const r = await app.inject({ method: 'POST', url: `/api/messages/${mid}/edit`, headers: auth(a.token), payload: { text: 'hello world' } })
    expect(r.statusCode).toBe(200)
    expect(r.json().message.text).toBe('hello world')
    expect(r.json().message.editedAt).toBeTypeOf('number')
    await app.close()
  })

  it('非作者不能编辑（403）；空/超长 body 400', async () => {
    const { app, a, b, mid } = await seed()
    expect((await app.inject({ method: 'POST', url: `/api/messages/${mid}/edit`, headers: auth(b.token), payload: { text: 'hax' } })).statusCode).toBe(403)
    expect((await app.inject({ method: 'POST', url: `/api/messages/${mid}/edit`, headers: auth(a.token), payload: { text: '' } })).statusCode).toBe(400)
    expect((await app.inject({ method: 'POST', url: `/api/messages/${mid}/edit`, headers: auth(a.token), payload: { text: 'x'.repeat(4001) } })).statusCode).toBe(400)
    await app.close()
  })

  it('仅文字可编辑：位置消息不可编辑（400 not_editable）', async () => {
    const { app, a, b } = await seed()
    const loc = await app.inject({ method: 'POST', url: '/api/messages', headers: auth(a.token), payload: { toId: b.user.id, kind: 'location', text: JSON.stringify({ lat: 31.2, lng: 121.5, name: '家' }) } })
    expect(loc.statusCode).toBe(201)
    const lid = (loc.json() as any).message.id as string
    const r = await app.inject({ method: 'POST', url: `/api/messages/${lid}/edit`, headers: auth(a.token), payload: { text: '改成文字' } })
    expect(r.statusCode).toBe(400)
    expect(r.json()).toMatchObject({ error: 'not_editable' })
    await app.close()
  })

  it('超出编辑窗口(15min) → 400 edit_window_passed', async () => {
    const { app, store, a, mid } = await seed()
    store.updateMessage(mid, { createdAt: Date.now() - 16 * 60_000 }) // 伪造 16 分钟前发出
    const r = await app.inject({ method: 'POST', url: `/api/messages/${mid}/edit`, headers: auth(a.token), payload: { text: '太晚了' } })
    expect(r.statusCode).toBe(400)
    expect(r.json()).toMatchObject({ error: 'edit_window_passed' })
    await app.close()
  })

  it('违禁词：编辑成违禁内容被拒（403 content_blocked）——防先发合规再编辑绕过审核', async () => {
    const { app, store, a, mid } = await seed()
    store.setAppConfig({ contentFilter: { enabled: true, terms: ['敏感词'] } })
    const r = await app.inject({ method: 'POST', url: `/api/messages/${mid}/edit`, headers: auth(a.token), payload: { text: '这里有敏感词' } })
    expect(r.statusCode).toBe(403)
    expect(r.json()).toMatchObject({ error: 'content_blocked' })
    // 原内容不变（编辑被拒不落库）。
    expect(store.findMessage(mid)?.text).toBe('helo wrold')
    await app.close()
  })

  it('已撤回的消息不可编辑（kind=recalled，not_editable）', async () => {
    const { app, a, mid } = await seed()
    await app.inject({ method: 'POST', url: `/api/messages/${mid}/recall`, headers: auth(a.token) })
    const r = await app.inject({ method: 'POST', url: `/api/messages/${mid}/edit`, headers: auth(a.token), payload: { text: '复活' } })
    expect(r.statusCode).toBe(400)
    expect(r.json()).toMatchObject({ error: 'not_editable' })
    await app.close()
  })
})

describe('引用回复 replyTo /api/messages', () => {
  it('引用同会话消息 → 存 replyTo；引用不存在的 id → 丢弃但照发', async () => {
    const store = new MemoryStore()
    const app = buildApp(store)
    const a = await reg(app, 'rplya', 'blind')
    const b = await reg(app, 'rplyb', 'helper')
    await bind(app, a.token, b.token, 'rplyb')
    const first = await app.inject({ method: 'POST', url: '/api/messages', headers: auth(a.token), payload: { toId: b.user.id, kind: 'text', text: '原始消息' } })
    const originId = (first.json() as any).message.id as string
    // b 引用 a 的原始消息回复。
    const reply = await app.inject({ method: 'POST', url: '/api/messages', headers: auth(b.token), payload: { toId: a.user.id, kind: 'text', text: '收到', replyTo: originId } })
    expect(reply.statusCode).toBe(201)
    expect((reply.json() as any).message.replyTo).toBe(originId)
    // 不存在的 replyTo → 丢弃（undefined），消息仍发出。
    const bad = await app.inject({ method: 'POST', url: '/api/messages', headers: auth(b.token), payload: { toId: a.user.id, kind: 'text', text: 'x', replyTo: 'no-such-message' } })
    expect(bad.statusCode).toBe(201)
    expect((bad.json() as any).message.replyTo).toBeUndefined()
    await app.close()
  })

  it('转发标记 forwarded：发送时置 true → 存库并读回；缺省不带', async () => {
    const store = new MemoryStore()
    const app = buildApp(store)
    const a = await reg(app, 'fwda', 'blind')
    const b = await reg(app, 'fwdb', 'helper')
    await bind(app, a.token, b.token, 'fwdb')
    const fwd = await app.inject({ method: 'POST', url: '/api/messages', headers: auth(a.token), payload: { toId: b.user.id, kind: 'text', text: '转发的内容', forwarded: true } })
    expect(fwd.statusCode).toBe(201)
    expect((fwd.json() as any).message.forwarded).toBe(true)
    // 普通消息不带 forwarded。
    const plain = await app.inject({ method: 'POST', url: '/api/messages', headers: auth(a.token), payload: { toId: b.user.id, kind: 'text', text: '原创' } })
    expect((plain.json() as any).message.forwarded).toBeUndefined()
    // 列表读回也保留。
    const list = await app.inject({ method: 'GET', url: `/api/messages?with=${b.user.id}`, headers: auth(a.token) })
    expect((list.json() as any).messages.find((m: any) => m.text === '转发的内容').forwarded).toBe(true)
    await app.close()
  })

  it('跨会话引用被拒（丢弃）：单聊不能引用群消息、群不能引用别处消息', async () => {
    const store = new MemoryStore()
    const app = buildApp(store)
    const a = await reg(app, 'xrepa', 'blind')
    const b = await reg(app, 'xrepb', 'helper')
    await bind(app, a.token, b.token, 'xrepb')
    // a 建群（含 b），在群里发一条消息。
    const grp = await app.inject({ method: 'POST', url: '/api/groups', headers: auth(a.token), payload: { name: '群', memberIds: [b.user.id] } })
    const gid = (grp.json() as any).group.id as string
    const gMsg = await app.inject({ method: 'POST', url: '/api/messages', headers: auth(a.token), payload: { groupId: gid, kind: 'text', text: '群消息' } })
    const gMsgId = (gMsg.json() as any).message.id as string
    // a 在**单聊**里引用**群**消息 → 丢弃（群消息 r.groupId 存在，单聊分支要求 !r.groupId）。
    const inDm = await app.inject({ method: 'POST', url: '/api/messages', headers: auth(a.token), payload: { toId: b.user.id, kind: 'text', text: '串到单聊', replyTo: gMsgId } })
    expect(inDm.statusCode).toBe(201)
    expect((inDm.json() as any).message.replyTo).toBeUndefined()
    // 单聊里的消息在**群**里被引用 → 丢弃（单聊消息 groupId 不等于 gid）。
    const dm = await app.inject({ method: 'POST', url: '/api/messages', headers: auth(a.token), payload: { toId: b.user.id, kind: 'text', text: '单聊消息' } })
    const dmId = (dm.json() as any).message.id as string
    const inG = await app.inject({ method: 'POST', url: '/api/messages', headers: auth(a.token), payload: { groupId: gid, kind: 'text', text: '串到群', replyTo: dmId } })
    expect((inG.json() as any).message.replyTo).toBeUndefined()
    // 同群内引用群消息 → 有效保留。
    const good = await app.inject({ method: 'POST', url: '/api/messages', headers: auth(a.token), payload: { groupId: gid, kind: 'text', text: '群内回复', replyTo: gMsgId } })
    expect((good.json() as any).message.replyTo).toBe(gMsgId)
    await app.close()
  })
})
