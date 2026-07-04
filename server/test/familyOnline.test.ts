import { describe, it, expect } from 'vitest'
import { buildApp } from '../src/app'
import { MemoryStore } from '../src/db/store'

// 亲友/协助者列表显示对方是否在线待命（与紧急路由 presence||hub 同口径）：帮助家人/协助者一眼看出谁此刻可呼叫。
describe('GET /api/family/links 含对方在线状态', () => {
  it('已建立关系+对方心跳在线→online:true；下线→false；pending 关系即便对方在线也不显示', async () => {
    const app = buildApp(new MemoryStore())
    const reg = async (u: string, role: string) =>
      (await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: u, password: 'strong-pass-9x', role } })).json()
    const blind = await reg('onblind', 'blind')
    const helper = await reg('onhelper', 'helper')
    const bh = { authorization: `Bearer ${blind.token}` }
    const hh = { authorization: `Bearer ${helper.token}` }
    const heartbeat = (available: boolean) => app.inject({ method: 'POST', url: '/api/assist/heartbeat', headers: hh, payload: { available } })
    const myLinks = async () => (await app.inject({ method: 'GET', url: '/api/family/links', headers: bh })).json().links

    const link = await app.inject({ method: 'POST', url: '/api/family/links', headers: bh, payload: { username: 'onhelper', relation: '志愿者', isEmergency: false } })
    await heartbeat(true) // helper 先上线

    // pending（未确认）：即便对方在线也不显示状态。
    expect((await myLinks())[0]).toMatchObject({ status: 'pending', online: false })

    // 接受后 + 对方在线 → online:true。
    await app.inject({ method: 'POST', url: `/api/family/links/${link.json().link.id}/accept`, headers: hh })
    expect((await myLinks())[0]).toMatchObject({ status: 'accepted', online: true })

    // 对方下线 → online:false。
    await heartbeat(false)
    expect((await myLinks())[0].online).toBe(false)
    await app.close()
  })
})
