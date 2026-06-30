import { describe, it, expect } from 'vitest'
import WebSocket from 'ws'
import { buildApp } from '../src/app'
import { MemoryStore } from '../src/db/store'

function nextMessage(ws: WebSocket, predicate: (m: any) => boolean): Promise<any> {
  return new Promise((resolve) => {
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString())
      if (predicate(msg)) resolve(msg)
    })
  })
}

function open(ws: WebSocket): Promise<void> {
  return new Promise((resolve) => ws.on('open', () => resolve()))
}

describe('WebRTC signaling relay', () => {
  it('relays offer and video-gate between two peers in the same call', async () => {
    const app = buildApp(new MemoryStore())
    await app.listen({ port: 0, host: '127.0.0.1' })
    const port = (app.server.address() as { port: number }).port

    const reg = async (u: string, role: string) => {
      const r = (await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: u, password: 'secret123', role } })).json()
      return { token: r.token as string, id: r.user.id as string }
    }
    const caller = await reg('caller', 'blind')
    const helper = await reg('helper', 'helper')
    const tCaller = caller.token, tHelper = helper.token

    // 真实流程：绑定亲友 → 对方接受(双向同意 #6) → 登记会合呼叫(callId 'c1' 入 pendingCalls) → 双方才能 join /ws（见审查 #8）。
    const link = await app.inject({ method: 'POST', url: '/api/family/links', headers: { authorization: `Bearer ${tCaller}` },
      payload: { username: 'helper', relation: '志愿者', isEmergency: true } })
    await app.inject({ method: 'POST', url: `/api/family/links/${link.json().link.id}/accept`, headers: { authorization: `Bearer ${tHelper}` } })
    const call = await app.inject({ method: 'POST', url: '/api/assist/call', headers: { authorization: `Bearer ${tCaller}` },
      payload: { callId: 'c1', targetUserIds: [helper.id] } })
    expect(call.statusCode).toBe(200)

    const base = `ws://127.0.0.1:${port}/ws`
    const ws1 = new WebSocket(`${base}?token=${tCaller}`)
    const ws2 = new WebSocket(`${base}?token=${tHelper}`)
    await Promise.all([open(ws1), open(ws2)])

    const joined1 = nextMessage(ws1, (m) => m.type === 'joined')
    const joined2 = nextMessage(ws2, (m) => m.type === 'joined')
    ws1.send(JSON.stringify({ type: 'join', callId: 'c1', role: 'blind' }))
    ws2.send(JSON.stringify({ type: 'join', callId: 'c1', role: 'helper' }))
    await Promise.all([joined1, joined2])

    // helper should receive caller's offer
    const offerAtHelper = nextMessage(ws2, (m) => m.type === 'offer')
    ws1.send(JSON.stringify({ type: 'offer', sdp: 'SDP_X' }))
    const offer = await offerAtHelper
    expect(offer.sdp).toBe('SDP_X')

    // caller should receive helper's video-gate notification
    const gateAtCaller = nextMessage(ws1, (m) => m.type === 'video-gate')
    ws2.send(JSON.stringify({ type: 'video-gate', on: true }))
    const gate = await gateAtCaller
    expect(gate.on).toBe(true)

    ws1.close()
    ws2.close()
    await app.close()
  })

  it('非对象 JSON 帧（null/数字/字符串/布尔）被忽略而不崩，连接仍可正常 join', async () => {
    const app = buildApp(new MemoryStore())
    await app.listen({ port: 0, host: '127.0.0.1' })
    const port = (app.server.address() as { port: number }).port
    const reg = async (u: string, role: string) => {
      const r = (await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: u, password: 'secret123', role } })).json()
      return { token: r.token as string, id: r.user.id as string }
    }
    const caller = await reg('caller', 'blind')
    const helper = await reg('helper', 'helper')
    const link = await app.inject({ method: 'POST', url: '/api/family/links', headers: { authorization: `Bearer ${caller.token}` },
      payload: { username: 'helper', relation: '志愿者', isEmergency: true } })
    await app.inject({ method: 'POST', url: `/api/family/links/${link.json().link.id}/accept`, headers: { authorization: `Bearer ${helper.token}` } })
    await app.inject({ method: 'POST', url: '/api/assist/call', headers: { authorization: `Bearer ${caller.token}` },
      payload: { callId: 'cN', targetUserIds: [helper.id] } })

    const ws1 = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${caller.token}`)
    await open(ws1)
    // 合法 JSON 但非对象：此前 `null` 会让 msg.type 抛 TypeError（未捕获于 message 处理器）。应被静默忽略。
    ws1.send('null'); ws1.send('123'); ws1.send('"x"'); ws1.send('true')
    // 紧接一个合法 join：若上面任一帧搞崩了 message 处理器/连接，这里就收不到 joined。
    const joined = nextMessage(ws1, (m) => m.type === 'joined')
    ws1.send(JSON.stringify({ type: 'join', callId: 'cN', role: 'blind' }))
    expect((await joined).type).toBe('joined')
    ws1.close()
    await app.close()
  })

  it('一端断开连接 → 另一端收到 peer-left（不卡在已掉线的通话里）', async () => {
    // 端到端锁定：socket close → hub.leave → 向房间剩余成员转发 peer-left。
    // hub.leave 有单测，但"真实断线触发通知对端"这条 UX 关键链路此前无集成测试。
    const app = buildApp(new MemoryStore())
    await app.listen({ port: 0, host: '127.0.0.1' })
    const port = (app.server.address() as { port: number }).port
    const reg = async (u: string, role: string) => {
      const r = (await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: u, password: 'secret123', role } })).json()
      return { token: r.token as string, id: r.user.id as string }
    }
    const caller = await reg('dc_caller', 'blind')
    const helper = await reg('dc_helper', 'helper')
    const link = await app.inject({ method: 'POST', url: '/api/family/links', headers: { authorization: `Bearer ${caller.token}` }, payload: { username: 'dc_helper' } })
    await app.inject({ method: 'POST', url: `/api/family/links/${link.json().link.id}/accept`, headers: { authorization: `Bearer ${helper.token}` } })
    await app.inject({ method: 'POST', url: '/api/assist/call', headers: { authorization: `Bearer ${caller.token}` }, payload: { callId: 'dc1', targetUserIds: [helper.id] } })

    const base = `ws://127.0.0.1:${port}/ws`
    const ws1 = new WebSocket(`${base}?token=${caller.token}`)
    const ws2 = new WebSocket(`${base}?token=${helper.token}`)
    await Promise.all([open(ws1), open(ws2)])
    const joined1 = nextMessage(ws1, (m) => m.type === 'joined')
    const joined2 = nextMessage(ws2, (m) => m.type === 'joined')
    ws1.send(JSON.stringify({ type: 'join', callId: 'dc1', role: 'blind' }))
    ws2.send(JSON.stringify({ type: 'join', callId: 'dc1', role: 'helper' }))
    await Promise.all([joined1, joined2])

    // caller 断线 → helper 必须收到 peer-left(带 caller userId)，以便结束/清理本端通话。
    const leftAtHelper = nextMessage(ws2, (m) => m.type === 'peer-left')
    ws1.close()
    const left = await leftAtHelper
    expect(left.userId).toBe(caller.id)

    ws2.close()
    await app.close()
  })

  it('rejects connection without a valid token', async () => {
    const app = buildApp(new MemoryStore())
    await app.listen({ port: 0, host: '127.0.0.1' })
    const port = (app.server.address() as { port: number }).port

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=bogus`)
    const closed = await new Promise<number>((resolve) => ws.on('close', (code) => resolve(code)))
    expect(closed).toBe(4001)
    await app.close()
  })

  it('rejects joining a call the user is not a participant of (no eavesdropping)', async () => {
    const app = buildApp(new MemoryStore())
    await app.listen({ port: 0, host: '127.0.0.1' })
    const port = (app.server.address() as { port: number }).port

    const reg = async (u: string, role: string) => {
      const r = (await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: u, password: 'secret123', role } })).json()
      return { token: r.token as string, id: r.user.id as string }
    }
    const caller = await reg('caller2', 'blind')
    const helper = await reg('helper2', 'helper')
    const attacker = await reg('attacker', 'helper') // 第三方：非该通话参与者

    const link2 = await app.inject({ method: 'POST', url: '/api/family/links', headers: { authorization: `Bearer ${caller.token}` },
      payload: { username: 'helper2', relation: '志愿者', isEmergency: true } })
    await app.inject({ method: 'POST', url: `/api/family/links/${link2.json().link.id}/accept`, headers: { authorization: `Bearer ${helper.token}` } })
    await app.inject({ method: 'POST', url: '/api/assist/call', headers: { authorization: `Bearer ${caller.token}` },
      payload: { callId: 'c2', targetUserIds: [helper.id] } })

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${attacker.token}`)
    await open(ws)
    const closed = new Promise<number>((resolve) => ws.on('close', (code) => resolve(code)))
    ws.send(JSON.stringify({ type: 'join', callId: 'c2', role: 'helper' })) // 攻击者知道 callId 仍不能加入
    expect(await closed).toBe(4003)
    await app.close()
  })
})
