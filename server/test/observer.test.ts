import { describe, it, expect } from 'vitest'
import WebSocket from 'ws'
import { buildApp } from '../src/app'
import { MemoryStore } from '../src/db/store'
import { hashPassword } from '../src/auth/passwords'

// 管理员合规旁观（会通知双方）的服务端准入与定向中继：
// - 仅 DB 角色为 admin 者可旁观；房间须进行中；同房间最多一名旁观管理员。
// - 能力门控：所有现有参与者都声明 adminObserver 才允许（保护旧版 App，不被第三方扰乱现网通话）。
// - obs-* 定向中继只到目标对端；1:1 主媒体（offer/answer/ice）绝不泄漏给旁观管理员。
// - 参与方必被告知：管理员加入时各端收到 peer-joined role:admin。

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
function closeInfo(ws: WebSocket): Promise<{ code: number; reason: string }> {
  return new Promise((resolve) => ws.on('close', (code, reason) => resolve({ code, reason: reason?.toString() ?? '' })))
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

/** 建一通进行中的 1:1 通话（caller=blind, helper），可选是否声明 adminObserver 能力。返回 ws/令牌/句柄。 */
async function liveCall(opts: { callerCaps?: boolean; helperCaps?: boolean } = {}) {
  const store = new MemoryStore()
  store.createUser({ id: 'admin1', username: 'root', passwordHash: hashPassword('rootpass1'), displayName: 'root', role: 'admin', status: 'active', createdAt: 1 })
  const app = buildApp(store)
  await app.listen({ port: 0, host: '127.0.0.1' })
  const port = (app.server.address() as { port: number }).port
  const base = `ws://127.0.0.1:${port}/ws`
  const reg = async (u: string, role: string) => {
    const r = (await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: u, password: 'secret123', role } })).json()
    return { token: r.token as string, id: r.user.id as string }
  }
  const caller = await reg('caller', 'blind')
  const helper = await reg('helper', 'helper')
  const link = await app.inject({ method: 'POST', url: '/api/family/links', headers: { authorization: `Bearer ${caller.token}` }, payload: { username: 'helper', relation: '志愿者', isEmergency: true } })
  await app.inject({ method: 'POST', url: `/api/family/links/${link.json().link.id}/accept`, headers: { authorization: `Bearer ${helper.token}` } })
  await app.inject({ method: 'POST', url: '/api/assist/call', headers: { authorization: `Bearer ${caller.token}` }, payload: { callId: 'c1', targetUserIds: [helper.id] } })
  const adminToken = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'root', password: 'rootpass1' } })).json().token
  const ws1 = new WebSocket(`${base}?token=${caller.token}`)
  const ws2 = new WebSocket(`${base}?token=${helper.token}`)
  await Promise.all([open(ws1), open(ws2)])
  const j1 = nextMessage(ws1, (m) => m.type === 'joined')
  const j2 = nextMessage(ws2, (m) => m.type === 'joined')
  const cap = (on?: boolean) => (on !== false ? { caps: ['adminObserver'] } : {})
  ws1.send(JSON.stringify({ type: 'join', callId: 'c1', role: 'blind', ...cap(opts.callerCaps) }))
  ws2.send(JSON.stringify({ type: 'join', callId: 'c1', role: 'helper', ...cap(opts.helperCaps) }))
  await Promise.all([j1, j2])
  return { app, store, base, ws1, ws2, caller, helper, adminToken }
}

describe('管理员旁观准入与定向中继', () => {
  it('双方均同意（声明能力）时管理员可旁观；各端被告知；obs-* 定向；1:1 主媒体不泄漏给管理员', async () => {
    const { app, base, ws1, ws2, caller, adminToken } = await liveCall({})
    const pjAtCaller = nextMessage(ws1, (m) => m.type === 'peer-joined' && m.role === 'admin')
    const pjAtHelper = nextMessage(ws2, (m) => m.type === 'peer-joined' && m.role === 'admin')
    const wsAdmin = new WebSocket(`${base}?token=${adminToken}`)
    await open(wsAdmin)
    const adminJoined = nextMessage(wsAdmin, (m) => m.type === 'joined')
    wsAdmin.send(JSON.stringify({ type: 'join', callId: 'c1', role: 'admin', observe: true, caps: ['adminObserver'] }))
    const aj = await adminJoined
    expect(aj.observer).toBe(true)
    expect(aj.peers.length).toBe(2) // 管理员看到两名参与者
    const pjc = await pjAtCaller
    const pjh = await pjAtHelper
    expect(pjc.userId).toBe('admin1')
    expect(pjh.role).toBe('admin') // 双方都被告知管理员加入监看（合规）

    // 参与者向管理员发 obs-offer（定向 to:admin1）→ 仅管理员收到，对端不收到。
    const obsAtAdmin = nextMessage(wsAdmin, (m) => m.type === 'obs-offer')
    let helperGotObs = false
    ws2.on('message', (d) => { if (JSON.parse(d.toString()).type === 'obs-offer') helperGotObs = true })
    ws1.send(JSON.stringify({ type: 'obs-offer', to: 'admin1', sdp: 'OBS_SDP' }))
    const obs = await obsAtAdmin
    expect(obs.sdp).toBe('OBS_SDP')
    expect(obs.from).toBe(caller.id)

    // 1:1 主 offer 只到对端，绝不泄漏给旁观管理员（管理员音视频走 obs-*）。
    const offerAtHelper = nextMessage(ws2, (m) => m.type === 'offer')
    let adminGotMainOffer = false
    wsAdmin.on('message', (d) => { if (JSON.parse(d.toString()).type === 'offer') adminGotMainOffer = true })
    ws1.send(JSON.stringify({ type: 'offer', sdp: 'MAIN_SDP' }))
    expect((await offerAtHelper).sdp).toBe('MAIN_SDP')
    await sleep(60)
    expect(adminGotMainOffer).toBe(false)
    expect(helperGotObs).toBe(false)

    ws1.close(); ws2.close(); wsAdmin.close(); await app.close()
  })

  it('非管理员（DB 角色非 admin）冒充 observe → 4003 not_admin', async () => {
    const { app, base, helper } = await liveCall({})
    const ws = new WebSocket(`${base}?token=${helper.token}`)
    await open(ws)
    const ci = closeInfo(ws)
    ws.send(JSON.stringify({ type: 'join', callId: 'c1', role: 'admin', observe: true, caps: ['adminObserver'] }))
    const r = await ci
    expect(r.code).toBe(4003)
    expect(r.reason).toBe('not_admin')
    await app.close()
  })

  it('能力门控：参与者未声明 adminObserver → 拒绝旁观（保护旧版 App）4003 call_not_observable', async () => {
    const { app, base, adminToken } = await liveCall({ callerCaps: false, helperCaps: false })
    const ws = new WebSocket(`${base}?token=${adminToken}`)
    await open(ws)
    const ci = closeInfo(ws)
    ws.send(JSON.stringify({ type: 'join', callId: 'c1', role: 'admin', observe: true, caps: ['adminObserver'] }))
    const r = await ci
    expect(r.code).toBe(4003)
    expect(r.reason).toBe('call_not_observable')
    await app.close()
  })

  it('能力门控：哪怕只有一名参与者不支持也拒绝（every 而非 some）', async () => {
    const { app, base, adminToken } = await liveCall({ callerCaps: true, helperCaps: false })
    const ws = new WebSocket(`${base}?token=${adminToken}`)
    await open(ws)
    const ci = closeInfo(ws)
    ws.send(JSON.stringify({ type: 'join', callId: 'c1', role: 'admin', observe: true, caps: ['adminObserver'] }))
    const r = await ci
    expect(r.code).toBe(4003)
    expect(r.reason).toBe('call_not_observable')
    await app.close()
  })

  it('空房间（无进行中通话）旁观 → 4003 call_not_active', async () => {
    const store = new MemoryStore()
    store.createUser({ id: 'admin1', username: 'root', passwordHash: hashPassword('rootpass1'), displayName: 'root', role: 'admin', status: 'active', createdAt: 1 })
    const app = buildApp(store)
    await app.listen({ port: 0, host: '127.0.0.1' })
    const port = (app.server.address() as { port: number }).port
    const adminToken = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'root', password: 'rootpass1' } })).json().token
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${adminToken}`)
    await open(ws)
    const ci = closeInfo(ws)
    ws.send(JSON.stringify({ type: 'join', callId: 'ghost', role: 'admin', observe: true, caps: ['adminObserver'] }))
    const r = await ci
    expect(r.code).toBe(4003)
    expect(r.reason).toBe('call_not_active')
    await app.close()
  })

  it('同房间最多一名旁观管理员：第二名 → 4003 observer_exists', async () => {
    const { app, store, base, adminToken } = await liveCall({})
    // 第一名管理员成功旁观。
    const wsA = new WebSocket(`${base}?token=${adminToken}`)
    await open(wsA)
    const aJoined = nextMessage(wsA, (m) => m.type === 'joined')
    wsA.send(JSON.stringify({ type: 'join', callId: 'c1', role: 'admin', observe: true, caps: ['adminObserver'] }))
    await aJoined
    // 第二名管理员（运行时新增，store 共享）被拒。
    store.createUser({ id: 'admin2', username: 'root2', passwordHash: hashPassword('rootpass2'), displayName: 'root2', role: 'admin', status: 'active', createdAt: 2 })
    const admin2Token = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'root2', password: 'rootpass2' } })).json().token
    const wsB = new WebSocket(`${base}?token=${admin2Token}`)
    await open(wsB)
    const ci = closeInfo(wsB)
    wsB.send(JSON.stringify({ type: 'join', callId: 'c1', role: 'admin', observe: true, caps: ['adminObserver'] }))
    const r = await ci
    expect(r.code).toBe(4003)
    expect(r.reason).toBe('observer_exists')
    wsA.close(); await app.close()
  })

  it('普通参与者自报 role:admin 被服务端净化（不伪造"管理员监看"告知、不污染实时总览）', async () => {
    // 单独建链，让 helper 在普通 join 分支谎称 role:'admin'（不带 observe）。
    const store = new MemoryStore()
    store.createUser({ id: 'admin1', username: 'root', passwordHash: hashPassword('rootpass1'), displayName: 'root', role: 'admin', status: 'active', createdAt: 1 })
    const app = buildApp(store)
    await app.listen({ port: 0, host: '127.0.0.1' })
    const port = (app.server.address() as { port: number }).port
    const base = `ws://127.0.0.1:${port}/ws`
    const reg = async (u: string, role: string) => {
      const r = (await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: u, password: 'secret123', role } })).json()
      return { token: r.token as string, id: r.user.id as string }
    }
    const caller = await reg('caller', 'blind')
    const helper = await reg('helper', 'helper')
    const link = await app.inject({ method: 'POST', url: '/api/family/links', headers: { authorization: `Bearer ${caller.token}` }, payload: { username: 'helper', relation: '志愿者', isEmergency: true } })
    await app.inject({ method: 'POST', url: `/api/family/links/${link.json().link.id}/accept`, headers: { authorization: `Bearer ${helper.token}` } })
    await app.inject({ method: 'POST', url: '/api/assist/call', headers: { authorization: `Bearer ${caller.token}` }, payload: { callId: 'c1', targetUserIds: [helper.id] } })

    const ws1 = new WebSocket(`${base}?token=${caller.token}`)
    await open(ws1)
    const j1 = nextMessage(ws1, (m) => m.type === 'joined')
    ws1.send(JSON.stringify({ type: 'join', callId: 'c1', role: 'blind', caps: ['adminObserver'] }))
    await j1

    // helper 谎称 role:'admin' 普通加入 → caller 收到的 peer-joined.role 必须被净化（绝非 'admin'）。
    const pjAtCaller = nextMessage(ws1, (m) => m.type === 'peer-joined')
    const ws2 = new WebSocket(`${base}?token=${helper.token}`)
    await open(ws2)
    ws2.send(JSON.stringify({ type: 'join', callId: 'c1', role: 'admin', caps: ['adminObserver'] }))
    const pj = await pjAtCaller
    expect(pj.userId).toBe(helper.id)
    expect(pj.role).not.toBe('admin') // 伪造的特权角色被净化为 'unknown'
    expect(pj.role).toBe('unknown')

    // 实时总览不被污染：hasAdminObserver 必须为 false（房内无真正的管理员旁观者）。
    const adminToken = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'root', password: 'rootpass1' } })).json().token
    const active = await app.inject({ method: 'GET', url: '/api/admin/calls/active', headers: { authorization: `Bearer ${adminToken}` } })
    const c1 = active.json().calls.find((c: { callId: string }) => c.callId === 'c1')
    expect(c1).toBeTruthy()
    expect(c1.hasAdminObserver).toBe(false)

    ws1.close(); ws2.close(); await app.close()
  })

  it('管理员断开 → 参与者收到 peer-left（用于清除监看态，通话继续）', async () => {
    const { app, base, ws1, adminToken } = await liveCall({})
    const wsA = new WebSocket(`${base}?token=${adminToken}`)
    await open(wsA)
    const aJoined = nextMessage(wsA, (m) => m.type === 'joined')
    // 等参与者先收到 peer-joined，确保管理员已入房。
    const pj = nextMessage(ws1, (m) => m.type === 'peer-joined' && m.role === 'admin')
    wsA.send(JSON.stringify({ type: 'join', callId: 'c1', role: 'admin', observe: true, caps: ['adminObserver'] }))
    await Promise.all([aJoined, pj])
    const leftAtCaller = nextMessage(ws1, (m) => m.type === 'peer-left' && m.userId === 'admin1')
    wsA.close()
    expect((await leftAtCaller).userId).toBe('admin1')
    ws1.close(); await app.close()
  })
})
