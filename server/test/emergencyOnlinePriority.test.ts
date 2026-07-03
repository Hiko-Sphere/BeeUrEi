import { describe, it, expect } from 'vitest'
import { buildApp } from '../src/app'
import { MemoryStore } from '../src/db/store'

// 端到端：/api/emergency/trigger 依据实时 presence 心跳排序——在线的紧急联系人排在离线的之前，
// 且响应带 isOnline 供客户端标注。证明 planEmergencyRoute 的在线加权真正接到了 presence。
describe('紧急呼叫目标：在线优先（端到端）', () => {
  async function seed() {
    const store = new MemoryStore()
    const a = buildApp(store)
    const reg = async (u: string, role?: string) =>
      (await a.inject({ method: 'POST', url: '/api/auth/register', payload: { username: u, password: 'secret123', role } })).json()
    const owner = await reg('owner')
    const early = await reg('early', 'family')
    const late = await reg('late', 'family')
    const auth = { authorization: `Bearer ${owner.token}` }
    // 链接直接经 store 建，**显式 createdAt（early=1000 < late=2000）**——杜绝 HTTP 两次 addEmergency
    // 落到同一毫秒时 planEmergencyRoute 的 (createdAt,id) tie 走随机 UUID、令"添加时间序"断言 flaky
    // （同毫秒排序的确定性由 routing.test 单测以受控 createdAt 覆盖；此处只验 presence 端到端接线）。
    store.createLink({ id: 'link-early', ownerId: owner.user.id, memberId: early.user.id, relation: '家人', isEmergency: true, createdAt: 1000, status: 'accepted' })
    store.createLink({ id: 'link-late', ownerId: owner.user.id, memberId: late.user.id, relation: '家人', isEmergency: true, createdAt: 2000, status: 'accepted' })
    return { a, owner, early, late, auth }
  }

  it('无人在线：退回添加时间序（early 在前）', async () => {
    const { a, auth } = await seed()
    const trig = await a.inject({ method: 'POST', url: '/api/emergency/trigger', headers: auth })
    const targets = trig.json().targets
    expect(targets.map((t: any) => t.memberName)).toEqual(['early', 'late'])
    expect(targets.every((t: any) => t.isOnline === false)).toBe(true)
    await a.close()
  })

  it('晚添加者在线 → 排到最前，且 isOnline=true（不在离线的 early 上白等）', async () => {
    const { a, late, auth } = await seed()
    // late 发一次可用心跳 → 上线。
    await a.inject({ method: 'POST', url: '/api/assist/heartbeat', headers: { authorization: `Bearer ${late.token}` }, payload: { available: true } })
    const trig = await a.inject({ method: 'POST', url: '/api/emergency/trigger', headers: auth })
    const targets = trig.json().targets
    expect(targets[0].memberName).toBe('late')   // 在线者被顶到最前
    expect(targets[0].isOnline).toBe(true)
    expect(targets[1].memberName).toBe('early')
    expect(targets[1].isOnline).toBe(false)
    await a.close()
  })
})
