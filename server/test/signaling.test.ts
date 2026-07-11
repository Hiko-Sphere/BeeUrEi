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

  it('同一用户重连同一通话：新连接顶替旧连接（不再被自己的僵尸占位挤成 call_full）', async () => {
    const app = buildApp(new MemoryStore())
    await app.listen({ port: 0, host: '127.0.0.1' })
    const port = (app.server.address() as { port: number }).port
    const reg = async (u: string, role: string) => {
      const r = (await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: u, password: 'secret123', role } })).json()
      return { token: r.token as string, id: r.user.id as string }
    }
    const caller = await reg('rcaller', 'blind')
    const helper = await reg('rhelper', 'helper')
    const link = await app.inject({ method: 'POST', url: '/api/family/links', headers: { authorization: `Bearer ${caller.token}` },
      payload: { username: 'rhelper', relation: '志愿者' } })
    await app.inject({ method: 'POST', url: `/api/family/links/${link.json().link.id}/accept`, headers: { authorization: `Bearer ${helper.token}` } })
    await app.inject({ method: 'POST', url: '/api/assist/call', headers: { authorization: `Bearer ${caller.token}` },
      payload: { callId: 'rc1', targetUserIds: [helper.id] } })

    const base = `ws://127.0.0.1:${port}/ws`
    const ws1 = new WebSocket(`${base}?token=${caller.token}`) // 盲人第一个连接（将成"僵尸"）
    const ws2 = new WebSocket(`${base}?token=${helper.token}`)
    await Promise.all([open(ws1), open(ws2)])
    const j1 = nextMessage(ws1, (m) => m.type === 'joined')
    const j2 = nextMessage(ws2, (m) => m.type === 'joined')
    ws1.send(JSON.stringify({ type: 'join', callId: 'rc1', role: 'blind' }))
    ws2.send(JSON.stringify({ type: 'join', callId: 'rc1', role: 'helper' }))
    await Promise.all([j1, j2])

    // 盲人"重连"（模拟半开掉线后新建 ws；旧 ws1 未 close，僵尸仍占房间名额）。
    const ws3 = new WebSocket(`${base}?token=${caller.token}`)
    await open(ws3)
    const oldClosed = new Promise<number>((resolve) => ws1.on('close', (code) => resolve(code)))
    const j3 = nextMessage(ws3, (m) => m.type === 'joined')
    ws3.send(JSON.stringify({ type: 'join', callId: 'rc1', role: 'blind' }))
    // 修复前：peersInCall=[僵尸盲人, helper]=2 → ws3 被 call_full(4003) 拒，本人再也回不到通话。
    // 修复后：旧连接被顶替（4000 replaced_by_reconnect），新连接正常入房、对端在 peers 里。
    const joined3 = await j3
    expect(joined3.peers.some((p: any) => p.userId === helper.id)).toBe(true)
    expect(await oldClosed).toBe(4000)
    // 重连后信令仍通：新连接发 offer，helper 收到（不再发进僵尸黑洞）。
    const offerAtHelper = nextMessage(ws2, (m) => m.type === 'offer')
    ws3.send(JSON.stringify({ type: 'offer', sdp: 'SDP_RECONNECT' }))
    expect((await offerAtHelper).sdp).toBe('SDP_RECONNECT')
    ws2.close(); ws3.close()
    await app.close()
  })

  it('每用户并发 ws 上限：超出即 4008 拒绝（防认证用户囤积连接耗尽资源），断开后名额释放', async () => {
    process.env.WS_MAX_PER_USER = '2'
    try {
      const app = buildApp(new MemoryStore())
      await app.listen({ port: 0, host: '127.0.0.1' })
      const port = (app.server.address() as { port: number }).port
      const r = (await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'wsflood', password: 'secret123', role: 'helper' } })).json()
      const base = `ws://127.0.0.1:${port}/ws?token=${r.token}`
      const a = new WebSocket(base), b = new WebSocket(base)
      await Promise.all([open(a), open(b)])
      // 第 3 条：超上限 → 4008 关闭。
      const c = new WebSocket(base)
      const cClosed = new Promise<number>((resolve) => c.on('close', (code) => resolve(code)))
      expect(await cClosed).toBe(4008)
      // 关一条 → 名额释放，新连接可入。
      a.close()
      await new Promise((r2) => a.on('close', r2))
      await new Promise((r2) => setTimeout(r2, 50)) // 等服务端 close 处理器清 map
      const d = new WebSocket(base)
      const dOk = new Promise<boolean>((resolve) => { d.on('open', () => resolve(true)); d.on('close', () => resolve(false)) })
      // open 后短暂窗口内不被服务端关闭即视为被接纳。
      expect(await dOk).toBe(true)
      b.close(); d.close()
      await app.close()
    } finally { delete process.env.WS_MAX_PER_USER }
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

  it('rejects a token whose account was banned or force-logged-out after issue (WS parity with REST)', async () => {
    // 回归：/ws 握手此前只验签(verifyAccessToken)，不查库；被封禁/改密/远程登出的用户仍能凭未过期的
    // access token 重新接入信令、继续与盲人的实时通话。现要求握手与 requireAuth 同源实时校验 status/tokenVersion/session。
    const store = new MemoryStore()
    const app = buildApp(store)
    await app.listen({ port: 0, host: '127.0.0.1' })
    const port = (app.server.address() as { port: number }).port
    const reg = async (u: string, role: string) => {
      const r = (await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: u, password: 'secret123', role } })).json()
      return { token: r.token as string, id: r.user.id as string }
    }

    // ① 封禁：status→disabled，握手必须立即 4001（REST 亦即时 401，不等 1h TTL）。
    const banned = await reg('ws_banned', 'helper')
    store.updateUser(banned.id, { status: 'disabled' })
    const wsB = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${banned.token}`)
    expect(await new Promise<number>((resolve) => wsB.on('close', (code) => resolve(code)))).toBe(4001)

    // ② 改密/强制下线：tokenVersion 递增使旧 access token 立即失效 → 握手 4001。
    const revoked = await reg('ws_revoked', 'helper')
    store.updateUser(revoked.id, { tokenVersion: 1 })
    const wsR = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${revoked.token}`)
    expect(await new Promise<number>((resolve) => wsR.on('close', (code) => resolve(code)))).toBe(4001)

    await app.close()
  })

  it('会话撤销(force-logout)即时踢掉在线信令 socket，对端收到 peer-left（不止拦重连）', async () => {
    // 补全：握手校验只拦"被撤销后重连"；已打开的 socket 还需被主动关闭，否则被封用户能在既有 socket
    // 上继续中继通话帧至 access token 到期。severSessions → callControl.disconnectUser → 关闭其所有 /ws。
    const store = new MemoryStore()
    const app = buildApp(store)
    await app.listen({ port: 0, host: '127.0.0.1' })
    const port = (app.server.address() as { port: number }).port
    const reg = async (u: string, role: string) => {
      const r = (await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: u, password: 'secret123', role } })).json()
      return { token: r.token as string, id: r.user.id as string }
    }
    const caller = await reg('kick_caller', 'blind')
    const helper = await reg('kick_helper', 'helper')
    const adminU = await reg('kick_admin', 'helper') // 注册 schema 不收 admin 角色 → 注册后直接提权
    store.updateUser(adminU.id, { role: 'admin' })
    const adminTok = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'kick_admin', password: 'secret123' } })).json().token

    const link = await app.inject({ method: 'POST', url: '/api/family/links', headers: { authorization: `Bearer ${caller.token}` }, payload: { username: 'kick_helper' } })
    await app.inject({ method: 'POST', url: `/api/family/links/${link.json().link.id}/accept`, headers: { authorization: `Bearer ${helper.token}` } })
    await app.inject({ method: 'POST', url: '/api/assist/call', headers: { authorization: `Bearer ${caller.token}` }, payload: { callId: 'kk1', targetUserIds: [helper.id] } })

    const base = `ws://127.0.0.1:${port}/ws`
    const ws1 = new WebSocket(`${base}?token=${caller.token}`)
    const ws2 = new WebSocket(`${base}?token=${helper.token}`)
    await Promise.all([open(ws1), open(ws2)])
    const joined1 = nextMessage(ws1, (m) => m.type === 'joined')
    const joined2 = nextMessage(ws2, (m) => m.type === 'joined')
    ws1.send(JSON.stringify({ type: 'join', callId: 'kk1', role: 'blind' }))
    ws2.send(JSON.stringify({ type: 'join', callId: 'kk1', role: 'helper' }))
    await Promise.all([joined1, joined2])

    // 管理员强制下线 caller：其 socket 应被关闭(4001)，helper 收到 peer-left(带 caller userId) 以便干净结束通话。
    const callerClosed = new Promise<number>((resolve) => ws1.on('close', (code) => resolve(code)))
    const leftAtHelper = nextMessage(ws2, (m) => m.type === 'peer-left')
    const fl = await app.inject({ method: 'POST', url: `/api/admin/users/${caller.id}/force-logout`, headers: { authorization: `Bearer ${adminTok}` } })
    expect(fl.statusCode).toBe(200)
    expect(await callerClosed).toBe(4001)
    expect((await leftAtHelper).userId).toBe(caller.id)

    ws2.close()
    await app.close()
  })

  it('自助删号即时踢掉本人在线信令 socket（4001）——删号用户不再能凭旧 token 中继', async () => {
    const app = buildApp(new MemoryStore())
    await app.listen({ port: 0, host: '127.0.0.1' })
    const port = (app.server.address() as { port: number }).port
    const u = (await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'del_self', password: 'secret123', role: 'blind' } })).json()
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${u.token}`)
    await open(ws)
    const closed = new Promise<number>((resolve) => ws.on('close', (code) => resolve(code)))
    // 本人删号（重验证：带密码）→ 级联删除 + 立即关闭其所有在线 /ws。
    const del = await app.inject({ method: 'DELETE', url: '/api/account', headers: { authorization: `Bearer ${u.token}` }, payload: { password: 'secret123' } })
    expect(del.statusCode).toBe(204)
    expect(await closed).toBe(4001) // 已打开的 socket 被立即关闭（此前会残留至 access token 到期）
    await app.close()
  })

  it('管理员删号即时踢掉目标在线信令 socket（4001）', async () => {
    const store = new MemoryStore()
    const app = buildApp(store)
    await app.listen({ port: 0, host: '127.0.0.1' })
    const port = (app.server.address() as { port: number }).port
    const reg = async (u: string) => (await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: u, password: 'secret123', role: 'blind' } })).json()
    const target = await reg('del_target')
    const adminU = await reg('del_admin')
    store.updateUser(adminU.user.id, { role: 'admin' })
    const adminTok = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'del_admin', password: 'secret123' } })).json().token
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${target.token}`)
    await open(ws)
    const closed = new Promise<number>((resolve) => ws.on('close', (code) => resolve(code)))
    const del = await app.inject({ method: 'DELETE', url: `/api/admin/users/${target.user.id}`, headers: { authorization: `Bearer ${adminTok}` } })
    expect(del.statusCode).toBe(200)
    expect(await closed).toBe(4001)
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

  it('自助改密即时踢在线 /ws（威胁模型：滥权照护者持设备，受害者改密须切断其实时信令通道，非只挡 REST）', async () => {
    // 回归：改密/重置/登出其它设备此前只升 tokenVersion + 删 refresh（挡 REST 与重连），攻击者**已打开**的 WS
    // 不受影响、可继续 join 通话/中继媒体/发文字至 access token 到期。现自助撤销点也 disconnectUser 即时关 socket。
    const store = new MemoryStore()
    const app = buildApp(store)
    await app.listen({ port: 0, host: '127.0.0.1' })
    const port = (app.server.address() as { port: number }).port
    const reg = async (u: string, role: string) => (await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: u, password: 'secret123', role } })).json()
    const victim = await reg('pwvictim', 'blind')
    const helper = await reg('pwhelper', 'helper')
    const link = await app.inject({ method: 'POST', url: '/api/family/links', headers: { authorization: `Bearer ${victim.token}` }, payload: { username: 'pwhelper', relation: '志愿者', isEmergency: true } })
    await app.inject({ method: 'POST', url: `/api/family/links/${link.json().link.id}/accept`, headers: { authorization: `Bearer ${helper.token}` } })
    await app.inject({ method: 'POST', url: '/api/assist/call', headers: { authorization: `Bearer ${victim.token}` }, payload: { callId: 'pwc', targetUserIds: [helper.user.id] } })

    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${victim.token}`)
    await open(ws)
    const joined = nextMessage(ws, (m) => m.type === 'joined') // 等 join 完成，确保 socket 已登记进 userSockets
    ws.send(JSON.stringify({ type: 'join', callId: 'pwc', role: 'blind' }))
    await joined
    const closed = new Promise<number>((resolve) => ws.on('close', (code) => resolve(code)))
    // 受害者在另一处改密（自救）——已打开的这条 WS 应被即时切断。
    const pw = await app.inject({ method: 'POST', url: '/api/account/password', headers: { authorization: `Bearer ${victim.token}` }, payload: { oldPassword: 'secret123', newPassword: 'NewStr0ngPass!9x' } })
    expect(pw.statusCode).toBe(200)
    expect(await closed).toBe(4001) // session_revoked：改密即时切断攻击者/旧设备的实时信令通道
    await app.close()
  })

  it('跨通话隔离：定向帧(msg.to)绝不逃逸到别的通话——A 房间成员无法把 offer 投给 B 房间的人', async () => {
    // 安全不变量：relay 恒以 hub.peersInCall(joined.callId) 为域，msg.to 只在**本房间**内定向。若日后误改成全局
    // 按 userId 查投递，恶意/漏洞客户端就能把 SDP/媒体信令投进不相干的通话（跨通话窃听/注入）。此测锁死。
    const app = buildApp(new MemoryStore())
    await app.listen({ port: 0, host: '127.0.0.1' })
    const port = (app.server.address() as { port: number }).port
    const reg = async (u: string, role: string) => {
      const r = (await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: u, password: 'secret123', role } })).json()
      return { token: r.token as string, id: r.user.id as string }
    }
    const bind = async (ownerTok: string, memberUser: string, memberTok: string) => {
      const l = await app.inject({ method: 'POST', url: '/api/family/links', headers: { authorization: `Bearer ${ownerTok}` }, payload: { username: memberUser, relation: '志愿者', isEmergency: true } })
      await app.inject({ method: 'POST', url: `/api/family/links/${l.json().link.id}/accept`, headers: { authorization: `Bearer ${memberTok}` } })
    }
    const a1 = await reg('xa1', 'blind'), a2 = await reg('xa2', 'helper')
    const b1 = await reg('xb1', 'blind'), b2 = await reg('xb2', 'helper')
    await bind(a1.token, 'xa2', a2.token); await bind(b1.token, 'xb2', b2.token)
    await app.inject({ method: 'POST', url: '/api/assist/call', headers: { authorization: `Bearer ${a1.token}` }, payload: { callId: 'cA', targetUserIds: [a2.id] } })
    await app.inject({ method: 'POST', url: '/api/assist/call', headers: { authorization: `Bearer ${b1.token}` }, payload: { callId: 'cB', targetUserIds: [b2.id] } })

    const base = `ws://127.0.0.1:${port}/ws`
    const wsA1 = new WebSocket(`${base}?token=${a1.token}`), wsA2 = new WebSocket(`${base}?token=${a2.token}`), wsB1 = new WebSocket(`${base}?token=${b1.token}`)
    await Promise.all([open(wsA1), open(wsA2), open(wsB1)])
    const jA1 = nextMessage(wsA1, (m) => m.type === 'joined'), jA2 = nextMessage(wsA2, (m) => m.type === 'joined'), jB1 = nextMessage(wsB1, (m) => m.type === 'joined')
    wsA1.send(JSON.stringify({ type: 'join', callId: 'cA', role: 'blind' }))
    wsA2.send(JSON.stringify({ type: 'join', callId: 'cA', role: 'helper' }))
    wsB1.send(JSON.stringify({ type: 'join', callId: 'cB', role: 'blind' }))
    await Promise.all([jA1, jA2, jB1])

    // b1 监听是否收到任何 offer（跨通话泄漏 = 收到）。
    let b1Leaked = false
    wsB1.on('message', (d) => { if (JSON.parse(d.toString()).type === 'offer') b1Leaked = true })
    // a1 先发一条定向 b1 的 offer（跨通话，必须被拦），紧接一条同房间 offer（到 a2，作同步点确认 relay 已处理两帧）。
    const a2Gets = nextMessage(wsA2, (m) => m.type === 'offer')
    wsA1.send(JSON.stringify({ type: 'offer', to: b1.id, sdp: 'LEAK' }))
    wsA1.send(JSON.stringify({ type: 'offer', sdp: 'LEGIT' }))
    expect((await a2Gets).sdp).toBe('LEGIT')                 // a2 只收到同房间那条（跨通话的被过滤掉、连 a2 都没投）
    await new Promise((r) => setTimeout(r, 40))
    expect(b1Leaked).toBe(false)                             // b1（另一通话）绝无收到 A 房间的 offer

    wsA1.close(); wsA2.close(); wsB1.close()
    await app.close()
  })

  it('超大信令帧(>256KiB)按 maxPayload 关闭连接(1009)——不放大内存', async () => {
    const app = buildApp(new MemoryStore())
    await app.listen({ port: 0, host: '127.0.0.1' })
    const port = (app.server.address() as { port: number }).port
    const caller = (await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'bigc', password: 'secret123', role: 'blind' } })).json()
    const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${caller.token}`)
    await open(ws)
    const closed = new Promise<number>((resolve) => ws.on('close', (code) => resolve(code)))
    ws.send('x'.repeat(300 * 1024)) // 300KiB > 256KiB 上限 → ws 层拒收并关闭，帧根本不进 message 处理器
    expect(await closed).toBe(1009) // 1009 = message too big
    await app.close()
  })

  it('参与者中继的 end 帧被剥离 by/adminId 归因（防伪造"管理员强制结束了通话"）', async () => {
    const app = buildApp(new MemoryStore())
    await app.listen({ port: 0, host: '127.0.0.1' })
    const port = (app.server.address() as { port: number }).port
    const reg = async (u: string, role: string) => {
      const r = (await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: u, password: 'secret123', role } })).json()
      return { token: r.token as string, id: r.user.id as string }
    }
    const caller = await reg('spoofc', 'blind')
    const helper = await reg('spoofh', 'helper')
    const link = await app.inject({ method: 'POST', url: '/api/family/links', headers: { authorization: `Bearer ${caller.token}` },
      payload: { username: 'spoofh', relation: '志愿者', isEmergency: true } })
    await app.inject({ method: 'POST', url: `/api/family/links/${link.json().link.id}/accept`, headers: { authorization: `Bearer ${helper.token}` } })
    await app.inject({ method: 'POST', url: '/api/assist/call', headers: { authorization: `Bearer ${caller.token}` }, payload: { callId: 'cE', targetUserIds: [helper.id] } })

    const base = `ws://127.0.0.1:${port}/ws`
    const ws1 = new WebSocket(`${base}?token=${caller.token}`), ws2 = new WebSocket(`${base}?token=${helper.token}`)
    await Promise.all([open(ws1), open(ws2)])
    const j1 = nextMessage(ws1, (m) => m.type === 'joined'), j2 = nextMessage(ws2, (m) => m.type === 'joined')
    ws1.send(JSON.stringify({ type: 'join', callId: 'cE', role: 'blind' }))
    ws2.send(JSON.stringify({ type: 'join', callId: 'cE', role: 'helper' }))
    await Promise.all([j1, j2])

    // 恶意参与者(caller)中继一条伪造管理员归因的 end。helper 侧应收到 end，但 by/adminId 被服务器剥离
    // → 客户端据 msg.by==='admin' 判定，故只会显示"对端挂断"而非伪造的"管理员强制结束"。
    const endAtHelper = nextMessage(ws2, (m) => m.type === 'end')
    ws1.send(JSON.stringify({ type: 'end', by: 'admin', adminId: 'evil' }))
    const end = await endAtHelper
    expect(end.by).toBeUndefined()       // 管理员归因被剥离
    expect(end.adminId).toBeUndefined()
    expect(end.from).toBe(caller.id)     // from 仍由服务器权威标注为真实发送者（不可冒名）
    ws1.close(); ws2.close(); await app.close()
  })
})
