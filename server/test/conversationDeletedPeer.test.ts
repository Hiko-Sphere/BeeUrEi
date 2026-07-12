import { describe, it, expect } from 'vitest'
import { buildApp } from '../src/app'
import { MemoryStore } from '../src/db/store'

// 会话列表已注销对端占位（i18n 根治）：服务端发**语言中立空 displayName**，不硬编码中文（客户端本地化）。
const auth = (t: string) => ({ authorization: `Bearer ${t}` })

describe('会话对端注销后 /api/conversations 占位', () => {
  it('对端注销 → 该会话 peer.displayName 为空串、status=disabled（客户端据此本地化，不漏中文）', async () => {
    const store = new MemoryStore()
    const app = buildApp(store)
    const reg = async (u: string, role: string) => (await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: u, password: 'strong-pass-9x', role } })).json()
    const a = await reg('cvOwner', 'blind')
    const b = await reg('cvGone', 'helper')
    // 建立绑定 + 一条消息 → A↔B 有会话。
    await app.inject({ method: 'POST', url: '/api/family/links', headers: auth(a.token), payload: { username: 'cvGone', relation: '志愿者' } })
    const inc = await app.inject({ method: 'GET', url: '/api/family/incoming', headers: auth(b.token) })
    await app.inject({ method: 'POST', url: `/api/family/links/${inc.json().links[0].id}/accept`, headers: auth(b.token) })
    await app.inject({ method: 'POST', url: '/api/messages', headers: auth(a.token), payload: { toId: b.user.id, kind: 'text', text: '你好' } })

    // 注销 B。
    store.deleteUser(b.user.id)
    const convos = (await app.inject({ method: 'GET', url: '/api/conversations', headers: auth(a.token) })).json().conversations
    const conv = convos.find((c: { peer: { id: string } }) => c.peer.id === b.user.id)
    expect(conv).toBeTruthy()
    expect(conv.peer.displayName).toBe('') // 语言中立空串，绝不硬编码「已注销用户」
    expect(conv.peer.status).toBe('disabled')
    await app.close()
  })
})
