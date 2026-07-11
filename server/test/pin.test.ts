import { describe, it, expect } from 'vitest'
import { buildApp } from '../src/app'
import { MemoryStore, JsonFileStore, convKeyFor, type ChatMessage, type Store } from '../src/db/store'
import { SqliteStore } from '../src/db/sqliteStore'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rmSync } from 'node:fs'

// 置顶消息（Telegram 式，每会话至多一条）：参与者置顶/取消；线程顶部横幅 pinned；撤回/删除自愈清理。

describe('convKeyFor 会话键（同一对话两端算出同一键）', () => {
  it('群 → g:<groupId>；单聊 → d:<两端升序>（互换 from/to 一致）', () => {
    expect(convKeyFor({ groupId: 'g1', fromId: 'x', toId: '' })).toBe('g:g1')
    const k1 = convKeyFor({ fromId: 'a', toId: 'b' })
    const k2 = convKeyFor({ fromId: 'b', toId: 'a' }) // 互换收发方
    expect(k1).toBe(k2) // 同一单聊算出同一键（否则置顶写入与线程读取对不上）
    expect(k1.startsWith('d:')).toBe(true)
  })
})

const dmsg = (id: string, fromId: string, toId: string): ChatMessage =>
  ({ id, fromId, toId, kind: 'text', text: 'hi', createdAt: Number(id.replace(/\D/g, '')) || 1 } as ChatMessage)

describe('setPin/getPin/clearPin/clearPinByMessage 两 store 一致', () => {
  for (const [label, make] of [['MemoryStore', () => new MemoryStore()], ['SqliteStore', () => new SqliteStore(':memory:')]] as [string, () => Store][]) {
    it(`${label}: 置顶覆盖式 + 取整条 + 取消 + 按消息取消 + 不串会话`, () => {
      const s = make()
      expect(s.getPin('d:x')).toBeUndefined() // 无置顶
      s.setPin('d:x', 'm1', 'u1', 1000)
      expect(s.getPin('d:x')).toEqual({ messageId: 'm1', pinnedBy: 'u1', pinnedAt: 1000 })
      s.setPin('d:x', 'm2', 'u2', 2000) // 覆盖式（每会话至多一条）
      expect(s.getPin('d:x')!.messageId).toBe('m2')
      s.setPin('g:g1', 'gm', 'u1', 3000) // 另一会话
      expect(s.getPin('g:g1')!.messageId).toBe('gm')
      s.clearPinByMessage('m2') // 撤回 m2 → d:x 的置顶清掉，g:g1 不动
      expect(s.getPin('d:x')).toBeUndefined()
      expect(s.getPin('g:g1')!.messageId).toBe('gm')
      s.clearPin('g:g1')
      expect(s.getPin('g:g1')).toBeUndefined()
    })
  }
})

describe('JsonFileStore 持久化：置顶存盘后重载不丢', () => {
  it('setPin → 落盘 → 新实例载盘还原', () => {
    const path = join(tmpdir(), `beeurei-pin-${randomUUID()}.json`)
    try {
      const s1 = new JsonFileStore(path)
      s1.setPin('d:x', 'm1', 'u1', 1000); s1.setPin('g:g1', 'gm', 'u2', 2000)
      const s2 = new JsonFileStore(path)
      expect(s2.getPin('d:x')).toEqual({ messageId: 'm1', pinnedBy: 'u1', pinnedAt: 1000 })
      expect(s2.getPin('g:g1')!.messageId).toBe('gm')
    } finally { rmSync(path, { force: true }) }
  })
})

describe('POST/DELETE /api/messages/:id/pin 端到端', () => {
  async function seed() {
    const store = new MemoryStore()
    const a = buildApp(store)
    const reg = async (u: string, role = 'helper') => (await a.inject({ method: 'POST', url: '/api/auth/register', payload: { username: u, password: 'secret123', role, displayName: u } })).json()
    const A = await reg('pinA'); const B = await reg('pinB', 'blind'); const C = await reg('pinC')
    const link = (await a.inject({ method: 'POST', url: '/api/family/links', headers: { authorization: `Bearer ${A.token}` }, payload: { username: 'pinB', relation: '家人', isEmergency: false } })).json()
    await a.inject({ method: 'POST', url: `/api/family/links/${link.link.id}/accept`, headers: { authorization: `Bearer ${B.token}` } })
    const sent = (await a.inject({ method: 'POST', url: '/api/messages', headers: { authorization: `Bearer ${A.token}` }, payload: { toId: B.user.id, kind: 'text', text: '家：幸福路9号' } })).json().message
    return { a, store, A, B, C, mid: sent.message?.id ?? sent.id as string }
  }
  const auth = (t: string) => ({ authorization: `Bearer ${t}` })

  it('参与者置顶 → 双方线程顶部 pinned 带该消息 + 置顶者名；取消 → pinned 为 null', async () => {
    const { a, A, B, mid } = await seed()
    const pinResp = await a.inject({ method: 'POST', url: `/api/messages/${mid}/pin`, headers: auth(A.token) })
    expect(pinResp.statusCode).toBe(200)
    expect(pinResp.json().pinned.id).toBe(mid)
    // B（对端）线程也见置顶。
    const asB = (await a.inject({ method: 'GET', url: `/api/messages?with=${A.user.id}`, headers: auth(B.token) })).json()
    expect(asB.pinned.id).toBe(mid)
    expect(asB.pinned.text).toContain('幸福路9号')
    expect(asB.pinned.pinnedByName).toBe('pinA') // 谁置顶的
    // 取消
    expect((await a.inject({ method: 'DELETE', url: `/api/messages/${mid}/pin`, headers: auth(B.token) })).statusCode).toBe(204)
    const asA = (await a.inject({ method: 'GET', url: `/api/messages?with=${B.user.id}`, headers: auth(A.token) })).json()
    expect(asA.pinned).toBeNull()
    await a.close()
  })

  it('置顶后撤回该消息 → pinned 自愈为 null（撤回空壳不留顶部）', async () => {
    const { a, A, B, mid } = await seed()
    await a.inject({ method: 'POST', url: `/api/messages/${mid}/pin`, headers: auth(A.token) })
    await a.inject({ method: 'POST', url: `/api/messages/${mid}/recall`, headers: auth(A.token) }) // A 是发送者、2 分钟内
    const asA = (await a.inject({ method: 'GET', url: `/api/messages?with=${B.user.id}`, headers: auth(A.token) })).json()
    expect(asA.pinned).toBeNull()
    await a.close()
  })

  it('非参与者（陌生人 C）不能置顶该单聊消息 → 403', async () => {
    const { a, C, mid } = await seed()
    expect((await a.inject({ method: 'POST', url: `/api/messages/${mid}/pin`, headers: auth(C.token) })).statusCode).toBe(403)
    await a.close()
  })
})
