import { describe, it, expect } from 'vitest'
import { buildApp } from '../src/app'
import { MemoryStore } from '../src/db/store'
import { compareContactLinks } from '../src/routes/family'

const names = (arr: Parameters<typeof compareContactLinks>[0][]) => [...arr].sort(compareContactLinks).map((x) => x.memberName)

describe('compareContactLinks（联系人列表稳定+安全优先排序）', () => {
  it('已接受在待确认之前', () => {
    expect(names([
      { memberName: 'Bob', status: 'pending' },
      { memberName: 'Amy', status: 'accepted' },
    ])).toEqual(['Amy', 'Bob'])
  })

  it('我的紧急联系人（amOwner∧isEmergency）置顶——即便其名在字母序上靠后（隔离紧急层，非碰巧靠前）', () => {
    expect(names([
      { memberName: 'Amy', status: 'accepted', amOwner: true, isEmergency: false }, // 普通，名靠前
      { memberName: 'Zoe', status: 'accepted', amOwner: true, isEmergency: true },  // 我的紧急联系人，名靠后
    ])).toEqual(['Zoe', 'Amy']) // 紧急层压过字母序
  })

  it('amOwner=false 的 isEmergency（我是对方的紧急联系人）不置顶——那是对方的安全网、非我要呼叫的人', () => {
    expect(names([
      { memberName: 'Amy', status: 'accepted', amOwner: false, isEmergency: true }, // 我是 Amy 的紧急联系人（非我的），名靠前
      { memberName: 'Zoe', status: 'accepted', amOwner: true, isEmergency: true },   // Zoe 是我的紧急联系人，名靠后
    ])).toEqual(['Zoe', 'Amy']) // Zoe(我的紧急)置顶，压过 Amy 的字母序——证明只认 amOwner∧isEmergency
  })

  it('同层按显示名排序（ASCII 确定序，稳定可预期）', () => {
    expect(names([
      { memberName: 'Carol', status: 'accepted' },
      { memberName: 'Alice', status: 'accepted' },
      { memberName: 'Bob', status: 'accepted' },
    ])).toEqual(['Alice', 'Bob', 'Carol'])
  })
})

describe('GET /api/family/links 应用排序（端到端）', () => {
  it('我的紧急联系人排在普通已接受联系人之前', async () => {
    const app = buildApp(new MemoryStore())
    const reg = async (u: string, role: string) => (await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: u, password: 'strong-pass-9x', role } })).json()
    const me = await reg('sortblind', 'blind')
    const zoe = await reg('zoe', 'helper')
    const amy = await reg('amy', 'family')
    const h = { authorization: `Bearer ${me.token}` }
    // me 加**普通**联系人 amy（名靠前）+ **紧急**联系人 zoe（名靠后）——紧急置顶须压过字母序才成立。
    const la = await app.inject({ method: 'POST', url: '/api/family/links', headers: h, payload: { username: 'amy', relation: '志愿者', isEmergency: false } })
    await app.inject({ method: 'POST', url: `/api/family/links/${la.json().link.id}/accept`, headers: { authorization: `Bearer ${amy.token}` } })
    const lz = await app.inject({ method: 'POST', url: '/api/family/links', headers: h, payload: { username: 'zoe', relation: '家人', isEmergency: true } })
    await app.inject({ method: 'POST', url: `/api/family/links/${lz.json().link.id}/accept`, headers: { authorization: `Bearer ${zoe.token}` } })

    const links = (await app.inject({ method: 'GET', url: '/api/family/links', headers: h })).json().links
    const accepted = links.filter((l: { status: string }) => l.status === 'accepted').map((l: { memberName: string }) => l.memberName)
    expect(accepted[0]).toBe('zoe') // 我的紧急联系人置顶（压过 amy 的字母序）
    expect(accepted).toContain('amy')
    await app.close()
  })
})
