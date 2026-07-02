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

/// 起一对已互链、已登记通话 c1 且都 join 完成的参与者。返回双端 socket 与清理函数。
async function callPair(store: MemoryStore) {
  const app = buildApp(store)
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
    payload: { callId: 'c1', targetUserIds: [helper.id] } })

  const base = `ws://127.0.0.1:${port}/ws`
  const ws1 = new WebSocket(`${base}?token=${caller.token}`)
  const ws2 = new WebSocket(`${base}?token=${helper.token}`)
  await Promise.all([open(ws1), open(ws2)])
  const joined1 = nextMessage(ws1, (m) => m.type === 'joined')
  const joined2 = nextMessage(ws2, (m) => m.type === 'joined')
  ws1.send(JSON.stringify({ type: 'join', callId: 'c1', role: 'blind' }))
  ws2.send(JSON.stringify({ type: 'join', callId: 'c1', role: 'helper' }))
  await Promise.all([joined1, joined2])
  return { app, ws1, ws2, caller, helper, close: async () => { ws1.close(); ws2.close(); await app.close() } }
}

describe('通话内实时文字（in-call-text）', () => {
  it('文本在双端间双向转发，带 from/at/回显 id', async () => {
    const { ws1, ws2, caller, helper, close } = await callPair(new MemoryStore())

    const atHelper = nextMessage(ws2, (m) => m.type === 'in-call-text')
    ws1.send(JSON.stringify({ type: 'in-call-text', text: '前面路口左转', id: 'm1' }))
    const got = await atHelper
    expect(got.text).toBe('前面路口左转')
    expect(got.from).toBe(caller.id)
    expect(got.id).toBe('m1')
    expect(typeof got.at).toBe('number')

    const atCaller = nextMessage(ws1, (m) => m.type === 'in-call-text')
    ws2.send(JSON.stringify({ type: 'in-call-text', text: 'ok, turn left' }))
    expect((await atCaller).from).toBe(helper.id)

    await close()
  })

  it('超长（>500 字）与空文本被拒且不转发，回执 invalid_text + 原 id', async () => {
    const { ws1, ws2, close } = await callPair(new MemoryStore())

    const rejected = nextMessage(ws1, (m) => m.type === 'in-call-text-rejected')
    ws1.send(JSON.stringify({ type: 'in-call-text', text: 'x'.repeat(501), id: 'long1' }))
    const r = await rejected
    expect(r.reason).toBe('invalid_text')
    expect(r.id).toBe('long1')

    const rejected2 = nextMessage(ws1, (m) => m.type === 'in-call-text-rejected' && m.id === 'empty1')
    ws1.send(JSON.stringify({ type: 'in-call-text', text: '   ', id: 'empty1' }))
    expect((await rejected2).reason).toBe('invalid_text')

    // 后发的合法消息先于任何被拒消息到达对端 → 被拒消息确实没被转发
    const atHelper = nextMessage(ws2, (m) => m.type === 'in-call-text')
    ws1.send(JSON.stringify({ type: 'in-call-text', text: '合法消息' }))
    expect((await atHelper).text).toBe('合法消息')

    await close()
  })

  it('违禁词命中 → content_blocked 回执，不转发（与消息内容过滤同口径）', async () => {
    const store = new MemoryStore()
    store.setAppConfig({ contentFilter: { enabled: true, terms: ['badword'] } })
    const { ws1, ws2, close } = await callPair(store)

    const rejected = nextMessage(ws1, (m) => m.type === 'in-call-text-rejected')
    ws1.send(JSON.stringify({ type: 'in-call-text', text: '这里有 BADWORD 内容', id: 'b1' }))
    const r = await rejected
    expect(r.reason).toBe('content_blocked')
    expect(r.id).toBe('b1')

    const atHelper = nextMessage(ws2, (m) => m.type === 'in-call-text')
    ws1.send(JSON.stringify({ type: 'in-call-text', text: '干净消息' }))
    expect((await atHelper).text).toBe('干净消息')

    await close()
  })

  it('令牌桶限速：突发超过 5 条即 rate_limited，对端收到的不超过桶容量', async () => {
    const { ws1, ws2, close } = await callPair(new MemoryStore())

    const receivedAtHelper: string[] = []
    ws2.on('message', (data) => {
      const m = JSON.parse(data.toString())
      if (m.type === 'in-call-text') receivedAtHelper.push(m.text)
    })
    const rateLimited = nextMessage(ws1, (m) => m.type === 'in-call-text-rejected' && m.reason === 'rate_limited')
    for (let i = 1; i <= 8; i++) ws1.send(JSON.stringify({ type: 'in-call-text', text: `msg${i}`, id: `r${i}` }))
    const r = await rateLimited
    expect(r.reason).toBe('rate_limited')
    // 稍等转发落地后核对：通过的不超过桶容量 5 且是前几条（顺序不乱）
    await new Promise((res) => setTimeout(res, 200))
    expect(receivedAtHelper.length).toBeLessThanOrEqual(5)
    expect(receivedAtHelper[0]).toBe('msg1')

    await close()
  })

  it('未 join 的连接发 in-call-text 被忽略（不崩、无回执、不泄漏到任何房间）', async () => {
    const store = new MemoryStore()
    const pair = await callPair(store)
    const port = (pair.app.server.address() as { port: number }).port
    const r = (await pair.app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'lurker', password: 'secret123', role: 'helper' } })).json()

    const wsL = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${r.token}`)
    await open(wsL)
    let lurkerGotAnything = false
    wsL.on('message', () => { lurkerGotAnything = true })
    wsL.send(JSON.stringify({ type: 'in-call-text', text: '未入房间的文本' }))

    // 房间内通信不受影响，且 lurker 文本未到达任何参与者
    const atHelper = nextMessage(pair.ws2, (m) => m.type === 'in-call-text')
    pair.ws1.send(JSON.stringify({ type: 'in-call-text', text: '正常通话文本' }))
    expect((await atHelper).text).toBe('正常通话文本')
    expect(lurkerGotAnything).toBe(false)

    wsL.close()
    await pair.close()
  })
})
