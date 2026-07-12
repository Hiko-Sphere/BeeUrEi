import { describe, it, expect } from 'vitest'
import { buildApp } from '../src/app'
import { MemoryStore } from '../src/db/store'

// /api/assist/help/request 每次登记都跑内容审核正则(matchBannedTerm)并把 topic/locality 广播进**全体在线志愿者**
// 的轮询队列，是与 /api/assist/call 同类的写扇出端点，却此前无端级限流——仅并发上限(activeCountFor≥5)挡"同时"，
// 挡不住 register→cancel→register 快速轮替刷审核+队列（并发数始终≤5 但请求速率无界）。本测证已补 30/min。
//
// 关键设计（与 assistCallRateLimit 同法）：payload 用**空 callId**（schema.min(1) 失败）→ 处理器第一步 400 早退，
// 从不触及 activeCountFor 那条**应用级 429**；故看到的 429 **只可能来自 fastify 端级限流**，中子（删限流 config）
// 时连打 35 次全 400、绝无 429 → 测试转红。若用合法 payload+不同 callId 则第 6 次会撞 activeCountFor 的应用级 429，
// 中子后仍 429 → 假通过，故必须走 400 早退这条不经过 activeCountFor 的路径。
const auth = (t: string) => ({ authorization: `Bearer ${t}` })

async function seed() {
  const app = buildApp(new MemoryStore())
  const me = (await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'helpspammer', password: 'secret123', role: 'blind' } })).json() as { token: string }
  return { app, token: me.token }
}

describe('/api/assist/help/request 端级限流（登记扇出全体志愿者队列防 churn，30/min）', () => {
  it('连打 >30 次触发 429（此前无端级限流——register→cancel→register 快速轮替刷审核+队列的旁路）', async () => {
    const { app, token } = await seed()
    let limited = false
    let firstStatus = 0
    for (let i = 0; i < 35; i++) {
      // 空 callId：schema.min(1) 失败 → 处理器立即 400（不进 activeCountFor），限流在处理器**之前**的 onRequest 钩子计数。
      const r = await app.inject({ method: 'POST', url: '/api/assist/help/request', headers: auth(token),
        payload: { callId: '' } })
      if (i === 0) firstStatus = r.statusCode
      if (r.statusCode === 429) { limited = true; break }
    }
    expect(firstStatus).toBe(400)  // 头一发是 400 invalid_input（证明限流阈值非 0 且未误命中 activeCountFor 的应用级 429）
    expect(limited).toBe(true)     // 连打超阈值最终被端级限流拦下
    await app.close()
  })
})
