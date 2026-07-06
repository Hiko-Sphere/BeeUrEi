import { describe, it, expect } from 'vitest'
import { buildApp } from '../src/app'
import { MemoryStore } from '../src/db/store'

// /api/assist/call 每次向各目标扇出 VoIP+APNs+Web 三路来电推送，是与 emergency/alert(6/min) 同类的**扇出**端点，
// 但此前无端级限流——仅并发上限(activeCountFor≥10)挡"同时"，挡不住 register→cancel→register 快速轮替刷来电推送
// （受害者按全局 300/min 仍可被 ~150 次/min 轰炸）。本测证已补 30/min：连打 >30 次触发 fastify 端级 429。
//
// 关键设计：目标填**不存在的用户** → 处理器一路 403 not_linked 早退，从不触及 activeCount/register，故那条 app 级
// 429 绝不会被触发；这样看到的 429 **只可能来自端级限流**，中子（删限流 config）时连打 35 次全 403、绝无 429→失败。
const auth = (t: string) => ({ authorization: `Bearer ${t}` })

async function seed() {
  const app = buildApp(new MemoryStore())
  const me = (await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'callspammer', password: 'secret123', role: 'blind' } })).json() as { token: string }
  return { app, token: me.token }
}

describe('/api/assist/call 端级限流（扇出来电推送防轰炸，30/min）', () => {
  it('连打 >30 次触发 429（此前无端级限流——快速轮替刷来电推送的旁路）', async () => {
    const { app, token } = await seed()
    let limited = false
    let firstStatus = 0
    for (let i = 0; i < 35; i++) {
      // 唯一 callId + 不存在的目标：处理器 403 not_linked 早退（不进 activeCount/register），限流在处理器**之前**计数。
      const r = await app.inject({ method: 'POST', url: '/api/assist/call', headers: auth(token),
        payload: { callId: `spam-${i}`, targetUserIds: ['nonexistent-user'] } })
      if (i === 0) firstStatus = r.statusCode
      if (r.statusCode === 429) { limited = true; break }
    }
    expect(firstStatus).not.toBe(429) // 头一发不该 429（证明限流阈值非 0，正常首呼放行）
    expect(limited).toBe(true)        // 连打超阈值最终被端级限流拦下
    await app.close()
  })
})
