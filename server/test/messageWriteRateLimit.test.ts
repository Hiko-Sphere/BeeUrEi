import { describe, it, expect } from 'vitest'
import { buildApp } from '../src/app'
import { MemoryStore } from '../src/db/store'

// 发送(/api/messages)早有 60/min 端级限流，但其**写兄弟** recall/edit/reaction 此前无端级限流：
// 三者同样每次写库、且经会话 last + 客户端轮询**触达对方并被盲人侧朗读**，反复贴表情/连改一条消息可绕过发送侧
// 60/min 刷对方播报与写库。本测证三者都已补上 60/min（默认全局 300/min 远松于此，改前打 60 余次不会 429，即失败）。
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

async function seed(nameA: string, nameB: string) {
  const app = buildApp(new MemoryStore())
  const a = await reg(app, nameA, 'blind')
  const b = await reg(app, nameB, 'helper')
  await bind(app, a.token, b.token, nameB)
  const sent = await app.inject({ method: 'POST', url: '/api/messages', headers: auth(a.token), payload: { toId: b.user.id, kind: 'text', text: 'hi' } })
  const mid = (sent.json() as any).message.id as string
  return { app, a, b, mid }
}

describe('消息写兄弟端级限流（与发送同 60/min，防刷对方播报/写库）', () => {
  it('表情回应连打超 60/min 被 429（此前无端级限流——反复贴表情刷盲人侧朗读的旁路）', async () => {
    const { app, a, mid } = await seed('rxa', 'rxb')
    // true/false 交替模拟"贴上→取消→贴上"刷播报环路。第 61 次起应被 fastify 端级限流 429。
    let limited = false
    for (let i = 0; i < 65; i++) {
      const r = await app.inject({ method: 'POST', url: `/api/messages/${mid}/reaction`, headers: auth(a.token), payload: { emoji: i % 2 === 0 ? '👍' : '' } })
      if (r.statusCode === 429) { limited = true; break }
    }
    expect(limited).toBe(true)
    await app.close()
  })

  it('编辑连打超 60/min 被 429（连改一条消息不断向对方注入新内容的旁路）', async () => {
    const { app, a, mid } = await seed('eda', 'edb')
    let limited = false
    for (let i = 0; i < 65; i++) {
      const r = await app.inject({ method: 'POST', url: `/api/messages/${mid}/edit`, headers: auth(a.token), payload: { text: `v${i}` } })
      if (r.statusCode === 429) { limited = true; break }
    }
    expect(limited).toBe(true)
    await app.close()
  })

  it('撤回端点也有 60/min 端级限流（穷举 id 连打的写库旁路）', async () => {
    const { app, a } = await seed('rca', 'rcb')
    // 撤回不存在的 id 会走 404，但限流在处理器**之前**计数，故连打仍会触发端级 429（证明限流已挂到该端点）。
    let limited = false
    for (let i = 0; i < 65; i++) {
      const r = await app.inject({ method: 'POST', url: `/api/messages/nonexistent-${i}/recall`, headers: auth(a.token) })
      if (r.statusCode === 429) { limited = true; break }
    }
    expect(limited).toBe(true)
    await app.close()
  })
})
