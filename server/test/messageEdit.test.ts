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
