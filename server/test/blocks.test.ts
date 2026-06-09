import { describe, it, expect } from 'vitest'
import { buildApp } from '../src/app'
import { MemoryStore } from '../src/db/store'

function app() { return buildApp(new MemoryStore()) }
const auth = (t: string) => ({ authorization: `Bearer ${t}` })
async function reg(a: ReturnType<typeof buildApp>, u: string, role = 'blind', language?: string) {
  return (await a.inject({ method: 'POST', url: '/api/auth/register', payload: { username: u, password: 'secret123', role, language } })).json() as {
    token: string; user: { id: string }
  }
}

describe('黑名单', () => {
  it('拉黑/列表/解除', async () => {
    const a = app()
    const me = await reg(a, 'blkA', 'blind')
    await reg(a, 'badguy', 'helper')
    expect((await a.inject({ method: 'POST', url: '/api/blocks', headers: auth(me.token), payload: { username: 'badguy' } })).statusCode).toBe(200)
    const list = await a.inject({ method: 'GET', url: '/api/blocks', headers: auth(me.token) })
    expect(list.json().blocks.length).toBe(1)
    expect(list.json().blocks[0].user.username).toBe('badguy')
    const id = list.json().blocks[0].id
    expect((await a.inject({ method: 'DELETE', url: `/api/blocks/${id}`, headers: auth(me.token) })).statusCode).toBe(204)
    expect((await a.inject({ method: 'GET', url: '/api/blocks', headers: auth(me.token) })).json().blocks.length).toBe(0)
    await a.close()
  })

  it('不能拉黑自己；需登录', async () => {
    const a = app()
    const me = await reg(a, 'blkB', 'blind')
    expect((await a.inject({ method: 'POST', url: '/api/blocks', headers: auth(me.token), payload: { username: 'blkB' } })).statusCode).toBe(400)
    expect((await a.inject({ method: 'POST', url: '/api/blocks', payload: { username: 'x' } })).statusCode).toBe(401)
    await a.close()
  })

  it('拉黑后：匹配不到、不能呼叫、加好友被拒（任一方向拉黑都生效）', async () => {
    const a = app()
    const blind = await reg(a, 'blkBlind', 'blind')
    const helper = await reg(a, 'blkHelper', 'helper')
    // 先建立 accepted 关系
    const lk = await a.inject({ method: 'POST', url: '/api/family/links', headers: auth(blind.token), payload: { username: 'blkHelper' } })
    await a.inject({ method: 'POST', url: `/api/family/links/${lk.json().link.id}/accept`, headers: auth(helper.token) })
    await a.inject({ method: 'POST', url: '/api/assist/heartbeat', headers: auth(helper.token), payload: { available: true } })
    // 匹配能找到
    expect((await a.inject({ method: 'POST', url: '/api/assist/match', headers: auth(blind.token), payload: { emergency: false } })).json().count).toBe(1)
    // helper 拉黑 blind（反方向）→ 匹配应排除、呼叫被拒
    await a.inject({ method: 'POST', url: '/api/blocks', headers: auth(helper.token), payload: { username: 'blkBlind' } })
    expect((await a.inject({ method: 'POST', url: '/api/assist/match', headers: auth(blind.token), payload: { emergency: false } })).json().count).toBe(0)
    expect((await a.inject({ method: 'POST', url: '/api/assist/call', headers: auth(blind.token), payload: { callId: 'blk-c', targetUserIds: [helper.user.id] } })).statusCode).toBe(403)
    // 再加好友（另一新人）被拉黑后不能加
    const other = await reg(a, 'blkOther', 'helper')
    await a.inject({ method: 'POST', url: '/api/blocks', headers: auth(blind.token), payload: { username: 'blkOther' } })
    expect((await a.inject({ method: 'POST', url: '/api/family/links', headers: auth(blind.token), payload: { username: 'blkOther' } })).statusCode).toBe(403)
    await a.close()
  })

  it('拉黑后：公开求助队列互不可见、不能认领、随机匹配跳过', async () => {
    const a = app()
    const blind = await reg(a, 'qBlind', 'blind')
    const helper = await reg(a, 'qHelper', 'helper')
    await a.inject({ method: 'POST', url: '/api/assist/help/request', headers: auth(blind.token), payload: { callId: 'q-blk' } })
    // 未拉黑：可见
    expect((await a.inject({ method: 'GET', url: '/api/assist/help/queue', headers: auth(helper.token) })).json().count).toBe(1)
    // 拉黑后：不可见 + 不能认领 + 随机匹配无果
    await a.inject({ method: 'POST', url: '/api/blocks', headers: auth(helper.token), payload: { username: 'qBlind' } })
    expect((await a.inject({ method: 'GET', url: '/api/assist/help/queue', headers: auth(helper.token) })).json().count).toBe(0)
    expect((await a.inject({ method: 'POST', url: '/api/assist/help/claim', headers: auth(helper.token), payload: { callId: 'q-blk' } })).statusCode).toBe(403)
    expect((await a.inject({ method: 'POST', url: '/api/assist/help/match', headers: auth(helper.token), payload: {} })).json().request).toBeNull()
    await a.close()
  })
})

describe('双向加好友（任一方发起，另一方确认）', () => {
  it('协助者发起 → 盲人确认 → 关系生效（owner 仍为盲人，匹配可用）', async () => {
    const a = app()
    const blind = await reg(a, 'biBlind', 'blind')
    const helper = await reg(a, 'biHelper', 'helper')
    // 协助者发起加盲人
    const lk = await a.inject({ method: 'POST', url: '/api/family/links', headers: auth(helper.token), payload: { username: 'biBlind' } })
    expect(lk.statusCode).toBe(201)
    // 盲人侧应在"待确认"里看到该请求（对方=协助者）
    const inc = await a.inject({ method: 'GET', url: '/api/family/incoming', headers: auth(blind.token) })
    expect(inc.json().links.length).toBe(1)
    expect(inc.json().links[0].ownerName).toBe('biHelper')
    // 发起者(协助者)不能自己确认
    expect((await a.inject({ method: 'POST', url: `/api/family/links/${lk.json().link.id}/accept`, headers: auth(helper.token) })).statusCode).toBe(404)
    // 盲人确认 → 生效
    expect((await a.inject({ method: 'POST', url: `/api/family/links/${lk.json().link.id}/accept`, headers: auth(blind.token) })).statusCode).toBe(200)
    // 关系对盲人匹配可用（owner=盲人）
    await a.inject({ method: 'POST', url: '/api/assist/heartbeat', headers: auth(helper.token), payload: { available: true } })
    expect((await a.inject({ method: 'POST', url: '/api/assist/match', headers: auth(blind.token), payload: { emergency: false } })).json().count).toBe(1)
    await a.close()
  })

  it('盲人发起 → 协助者确认（原方向仍可用）', async () => {
    const a = app()
    const blind = await reg(a, 'biBlind2', 'blind')
    const helper = await reg(a, 'biHelper2', 'helper')
    const lk = await a.inject({ method: 'POST', url: '/api/family/links', headers: auth(blind.token), payload: { username: 'biHelper2' } })
    // 盲人(发起者)不能自己确认
    expect((await a.inject({ method: 'POST', url: `/api/family/links/${lk.json().link.id}/accept`, headers: auth(blind.token) })).statusCode).toBe(404)
    // 协助者确认 → 生效
    expect((await a.inject({ method: 'POST', url: `/api/family/links/${lk.json().link.id}/accept`, headers: auth(helper.token) })).statusCode).toBe(200)
    await a.close()
  })
})
