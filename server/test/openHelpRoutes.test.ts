import { describe, it, expect } from 'vitest'
import WebSocket from 'ws'
import { buildApp } from '../src/app'
import { MemoryStore } from '../src/db/store'

function app() {
  return buildApp(new MemoryStore())
}
const auth = (t: string) => ({ authorization: `Bearer ${t}` })

async function reg(a: ReturnType<typeof buildApp>, username: string, role = 'blind', language?: string) {
  const res = await a.inject({
    method: 'POST',
    url: '/api/auth/register',
    payload: { username, password: 'secret123', role, language },
  })
  return res.json() as { token: string; user: { id: string } }
}

function open(ws: WebSocket): Promise<void> {
  return new Promise((resolve) => ws.on('open', () => resolve()))
}
function nextMessage(ws: WebSocket, predicate: (m: any) => boolean): Promise<any> {
  return new Promise((resolve) => {
    ws.on('message', (data) => {
      const msg = JSON.parse(data.toString())
      if (predicate(msg)) resolve(msg)
    })
  })
}

describe('公开求助队列路由', () => {
  it('视障广播 → 志愿者看到摘要（粗粒度，不含 fromUserId）→ 认领得到详情', async () => {
    const a = app()
    const blind = await reg(a, 'blindA', 'blind', 'zh')
    const helper = await reg(a, 'helperA', 'helper')

    const r = await a.inject({
      method: 'POST',
      url: '/api/assist/help/request',
      headers: auth(blind.token),
      payload: { callId: 'help-1', locality: '上海市', topic: '帮我看红绿灯' },
    })
    expect(r.statusCode).toBe(200)

    const q = await a.inject({ method: 'GET', url: '/api/assist/help/queue', headers: auth(helper.token) })
    const body = q.json()
    expect(body.count).toBe(1)
    expect(body.requests[0].callId).toBe('help-1')
    expect(body.requests[0].fromName).toBe('blindA')
    expect(body.requests[0].language).toBe('zh') // 取账号语言
    expect(body.requests[0].locality).toBe('上海市')
    expect(body.requests[0].topic).toBe('帮我看红绿灯')
    expect(body.requests[0].fromUserId).toBeUndefined() // 隐私：不暴露用户 id

    // 请求者自己看队列看不到自己的求助
    const qSelf = await a.inject({ method: 'GET', url: '/api/assist/help/queue', headers: auth(blind.token) })
    expect(qSelf.json().count).toBe(0)

    // 认领 → 得到详情
    const claim = await a.inject({ method: 'POST', url: '/api/assist/help/claim', headers: auth(helper.token), payload: { callId: 'help-1' } })
    expect(claim.statusCode).toBe(200)
    expect(claim.json().request.fromName).toBe('blindA')
    expect(claim.json().request.locality).toBe('上海市')

    // 认领后从队列消失
    const q2 = await a.inject({ method: 'GET', url: '/api/assist/help/queue', headers: auth(helper.token) })
    expect(q2.json().count).toBe(0)
    await a.close()
  })

  it('一条求助只能被一位志愿者认领（第二位 409）', async () => {
    const a = app()
    const blind = await reg(a, 'blindB', 'blind')
    const h1 = await reg(a, 'helperB1', 'helper')
    const h2 = await reg(a, 'helperB2', 'helper')
    await a.inject({ method: 'POST', url: '/api/assist/help/request', headers: auth(blind.token), payload: { callId: 'help-2' } })
    expect((await a.inject({ method: 'POST', url: '/api/assist/help/claim', headers: auth(h1.token), payload: { callId: 'help-2' } })).statusCode).toBe(200)
    const second = await a.inject({ method: 'POST', url: '/api/assist/help/claim', headers: auth(h2.token), payload: { callId: 'help-2' } })
    expect(second.statusCode).toBe(409)
    await a.close()
  })

  it('随机/偏好匹配：偏好语言优先并直接认领；无匹配时 request 为 null', async () => {
    const a = app()
    const b1 = await reg(a, 'blindEn', 'blind', 'en')
    const b2 = await reg(a, 'blindZh', 'blind', 'zh')
    const helper = await reg(a, 'helperC', 'helper')
    await a.inject({ method: 'POST', url: '/api/assist/help/request', headers: auth(b1.token), payload: { callId: 'h-en' } })
    await a.inject({ method: 'POST', url: '/api/assist/help/request', headers: auth(b2.token), payload: { callId: 'h-zh' } })

    const m = await a.inject({ method: 'POST', url: '/api/assist/help/match', headers: auth(helper.token), payload: { preferredLanguage: 'zh' } })
    expect(m.json().request.callId).toBe('h-zh') // 偏好 zh → 命中 zh

    // 剩 h-en；强制要求 zh → 无匹配
    const m2 = await a.inject({ method: 'POST', url: '/api/assist/help/match', headers: auth(helper.token), payload: { preferredLanguage: 'zh', requireLanguageMatch: true } })
    expect(m2.json().request).toBeNull()
    await a.close()
  })

  it('认领后双方可加入 callId 信令房间，陌生第三方仍被拒', async () => {
    const a = app()
    await a.listen({ port: 0, host: '127.0.0.1' })
    const port = (a.server.address() as { port: number }).port
    const blind = await reg(a, 'blindD', 'blind')
    const helper = await reg(a, 'helperD', 'helper')
    const stranger = await reg(a, 'strangerD', 'helper')

    await a.inject({ method: 'POST', url: '/api/assist/help/request', headers: auth(blind.token), payload: { callId: 'help-room' } })

    // 认领前：陌生人（甚至志愿者）都不能 join（participants 只有请求者）
    const wsEarly = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${helper.token}`)
    await open(wsEarly)
    const earlyClosed = new Promise<number>((resolve) => wsEarly.on('close', (c) => resolve(c)))
    wsEarly.send(JSON.stringify({ type: 'join', callId: 'help-room', role: 'helper' }))
    expect(await earlyClosed).toBe(4003)

    // 认领后：该志愿者可入会
    await a.inject({ method: 'POST', url: '/api/assist/help/claim', headers: auth(helper.token), payload: { callId: 'help-room' } })

    const ws1 = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${blind.token}`)
    const ws2 = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${helper.token}`)
    await Promise.all([open(ws1), open(ws2)])
    const joined1 = nextMessage(ws1, (m) => m.type === 'joined')
    const joined2 = nextMessage(ws2, (m) => m.type === 'joined')
    ws1.send(JSON.stringify({ type: 'join', callId: 'help-room', role: 'blind' }))
    ws2.send(JSON.stringify({ type: 'join', callId: 'help-room', role: 'helper' }))
    await Promise.all([joined1, joined2])

    // 未认领的陌生人仍被拒
    const ws3 = new WebSocket(`ws://127.0.0.1:${port}/ws?token=${stranger.token}`)
    await open(ws3)
    const strangerClosed = new Promise<number>((resolve) => ws3.on('close', (c) => resolve(c)))
    ws3.send(JSON.stringify({ type: 'join', callId: 'help-room', role: 'helper' }))
    expect(await strangerClosed).toBe(4003)

    ws1.close(); ws2.close()
    await a.close()
  })

  it('请求者撤销后队列清空；认领者放弃后释放回队列', async () => {
    const a = app()
    const blind = await reg(a, 'blindE', 'blind')
    const helper = await reg(a, 'helperE', 'helper')
    await a.inject({ method: 'POST', url: '/api/assist/help/request', headers: auth(blind.token), payload: { callId: 'help-cancel' } })
    await a.inject({ method: 'POST', url: '/api/assist/help/claim', headers: auth(helper.token), payload: { callId: 'help-cancel' } })

    // 志愿者放弃 → 回到队列
    await a.inject({ method: 'POST', url: '/api/assist/help/cancel', headers: auth(helper.token), payload: { callId: 'help-cancel' } })
    expect((await a.inject({ method: 'GET', url: '/api/assist/help/queue', headers: auth(helper.token) })).json().count).toBe(1)

    // 请求者撤销 → 队列空
    await a.inject({ method: 'POST', url: '/api/assist/help/cancel', headers: auth(blind.token), payload: { callId: 'help-cancel' } })
    expect((await a.inject({ method: 'GET', url: '/api/assist/help/queue', headers: auth(helper.token) })).json().count).toBe(0)
    await a.close()
  })

  it('help 端点需要登录', async () => {
    const a = app()
    expect((await a.inject({ method: 'GET', url: '/api/assist/help/queue' })).statusCode).toBe(401)
    expect((await a.inject({ method: 'POST', url: '/api/assist/help/request', payload: { callId: 'x' } })).statusCode).toBe(401)
    await a.close()
  })
})
