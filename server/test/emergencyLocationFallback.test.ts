import { describe, it, expect } from 'vitest'
import { buildApp } from '../src/app'
import { MemoryStore } from '../src/db/store'

// 端到端：摔倒告警缺当前坐标时，兜底用用户"最后已知共享位置"，并诚实标注来源与时效。
describe('紧急告警位置兜底（端到端）', () => {
  async function seed() {
    const a = buildApp(new MemoryStore())
    const reg = async (u: string, role?: string) =>
      (await a.inject({ method: 'POST', url: '/api/auth/register', payload: { username: u, password: 'secret123', role } })).json()
    const owner = await reg('faller')
    const mom = await reg('mom', 'family')
    const auth = { authorization: `Bearer ${owner.token}` }
    const l = await a.inject({ method: 'POST', url: '/api/family/links', headers: auth, payload: { username: 'mom', relation: '妈妈', isEmergency: true } })
    await a.inject({ method: 'POST', url: `/api/family/links/${l.json().link.id}/accept`, headers: { authorization: `Bearer ${mom.token}` } })
    return { a, owner, mom, auth }
  }

  // 读 mom 的通知，取最新一条 emergency_alert 的 data。
  async function momAlertData(a: any, momToken: string) {
    const res = await a.inject({ method: 'GET', url: '/api/notifications', headers: { authorization: `Bearer ${momToken}` } })
    const list = res.json().notifications ?? res.json().items ?? res.json()
    const alerts = (Array.isArray(list) ? list : []).filter((n: any) => n.kind === 'emergency_alert')
    return alerts[0]?.data
  }

  it('无当前坐标 + 用户正共享位置 → 兜底最后已知，标 source=lastKnown 且带 ageSec', async () => {
    const { a, owner, mom, auth } = await seed()
    // 用户开启位置共享，上报一个位置。
    await a.inject({ method: 'POST', url: '/api/locations/update', headers: auth, payload: { lat: 31.23, lng: 121.47, ttlSec: 3600 } })
    // 摔倒告警不带坐标。
    const res = await a.inject({ method: 'POST', url: '/api/emergency/alert', headers: auth, payload: { kind: 'fall' } })
    expect(res.statusCode).toBe(200)
    expect(res.json().location.source).toBe('lastKnown')
    expect(typeof res.json().location.ageSec).toBe('number')
    // mom 的通知里带上了兜底坐标与来源标注。
    const data = await momAlertData(a, mom.token)
    expect(data.lat).toBe('31.23')
    expect(data.lon).toBe('121.47')
    expect(data.locSource).toBe('lastKnown')
    await a.close()
  })

  it('自带当前坐标 → source=live，不覆盖为兜底', async () => {
    const { a, mom, auth } = await seed()
    await a.inject({ method: 'POST', url: '/api/locations/update', headers: auth, payload: { lat: 10, lng: 20, ttlSec: 3600 } })
    const res = await a.inject({ method: 'POST', url: '/api/emergency/alert', headers: auth, payload: { kind: 'crash', lat: 39.9, lon: 116.4 } })
    expect(res.json().location.source).toBe('live')
    const data = await momAlertData(a, mom.token)
    expect(data.lat).toBe('39.9')        // 用自带的，不是共享的 10
    expect(data.locSource).toBe('live')
    await a.close()
  })

  it('无坐标且未共享位置 → source=none（客户端据此提示"未附位置"）', async () => {
    const { a, auth } = await seed()
    const res = await a.inject({ method: 'POST', url: '/api/emergency/alert', headers: auth, payload: { kind: 'manual' } })
    expect(res.json().location.source).toBe('none')
    expect(res.json().ok).toBe(true) // 告警仍照发，只是没位置
    await a.close()
  })
})
