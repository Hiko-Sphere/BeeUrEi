import { describe, it, expect } from 'vitest'
import { MemoryStore, type User } from '../src/db/store'
import { isRealtimeReachable, blindSosReadiness } from '../src/emergency/reachability'

// 应急「即时推送可触达」+ 盲人安全网就绪度：单点定义，emergency 就绪自检 / admin 用户详情 / admin 预防性观测共用。
function mkUser(id: string, over: Partial<User> = {}): User {
  return { id, username: id, passwordHash: 'x', displayName: id, role: 'family', status: 'active', createdAt: 1, ...over }
}

describe('isRealtimeReachable（即时推送可触达，门控 webPushConfigured）', () => {
  it('有 APNs token → 可达（不论 webPush 是否配置）', () => {
    const s = new MemoryStore(); s.createUser(mkUser('u1'))
    expect(isRealtimeReachable(s, false, 'u1', 'a'.repeat(64))).toBe(true)
    expect(isRealtimeReachable(s, true, 'u1', 'a'.repeat(64))).toBe(true)
  })
  it('无任何推送通道 → 不可达', () => {
    const s = new MemoryStore(); s.createUser(mkUser('u1'))
    expect(isRealtimeReachable(s, true, 'u1', undefined)).toBe(false)
  })
  it('仅 Web 订阅：webPush 已配置→可达；未配置→不可达（没 VAPID 发不出，勿高估）', () => {
    const s = new MemoryStore(); s.createUser(mkUser('u1'))
    s.upsertWebPushSubscription({ endpoint: 'https://p.example/u1', userId: 'u1', p256dh: 'k', auth: 'x', createdAt: 1 })
    expect(isRealtimeReachable(s, true, 'u1', undefined)).toBe(true)
    expect(isRealtimeReachable(s, false, 'u1', undefined)).toBe(false)
  })
})

describe('blindSosReadiness（盲人安全网就绪，以实际告警扇出面为准）', () => {
  const mkBlind = (s: MemoryStore) => { s.createUser(mkUser('blind', { role: 'blind' })) }

  it('无任何联系人 → acceptedTotal=0（安全网空）', () => {
    const s = new MemoryStore(); mkBlind(s)
    expect(blindSosReadiness(s, true, 'blind')).toEqual({ acceptedTotal: 0, acceptedReachable: 0 })
  })

  it('全体 accepted 计入（非仅 isEmergency），可达数按即时推送算', () => {
    const s = new MemoryStore(); mkBlind(s)
    s.createUser(mkUser('c1', { apnsToken: 'a'.repeat(64) })) // 可达
    s.createUser(mkUser('c2')) // 不可达
    s.createLink({ id: 'l1', ownerId: 'blind', memberId: 'c1', relation: '家人', isEmergency: true, createdAt: 1, status: 'accepted' })
    s.createLink({ id: 'l2', ownerId: 'blind', memberId: 'c2', relation: '朋友', isEmergency: false, createdAt: 2, status: 'accepted' })
    expect(blindSosReadiness(s, true, 'blind')).toEqual({ acceptedTotal: 2, acceptedReachable: 1 })
  })

  it('pending 联系人不计入扇出面', () => {
    const s = new MemoryStore(); mkBlind(s)
    s.createUser(mkUser('c1', { apnsToken: 'a'.repeat(64) }))
    s.createLink({ id: 'l1', ownerId: 'blind', memberId: 'c1', relation: '家人', isEmergency: true, createdAt: 1, status: 'pending' })
    expect(blindSosReadiness(s, true, 'blind')).toEqual({ acceptedTotal: 0, acceptedReachable: 0 })
  })

  it('被互相拉黑的联系人排除（拉黑即撤回，不参与告警扇出）——安全网视为对其失效', () => {
    const s = new MemoryStore(); mkBlind(s)
    s.createUser(mkUser('c1', { apnsToken: 'a'.repeat(64) }))
    s.createLink({ id: 'l1', ownerId: 'blind', memberId: 'c1', relation: '家人', isEmergency: true, createdAt: 1, status: 'accepted' })
    s.createBlock({ id: 'b1', blockerId: 'blind', blockedId: 'c1', createdAt: 1 })
    expect(blindSosReadiness(s, true, 'blind')).toEqual({ acceptedTotal: 0, acceptedReachable: 0 })
  })

  it('有联系人但全不可达 → acceptedTotal>0 且 acceptedReachable=0（安全网悄然失效的判据）', () => {
    const s = new MemoryStore(); mkBlind(s)
    s.createUser(mkUser('c1')) // 无推送
    s.upsertWebPushSubscription({ endpoint: 'https://p.example/c1', userId: 'c1', p256dh: 'k', auth: 'x', createdAt: 1 })
    s.createLink({ id: 'l1', ownerId: 'blind', memberId: 'c1', relation: '家人', isEmergency: true, createdAt: 1, status: 'accepted' })
    // webPush 未配置：web 订阅不算可达
    expect(blindSosReadiness(s, false, 'blind')).toEqual({ acceptedTotal: 1, acceptedReachable: 0 })
    // webPush 已配置：同一订阅算可达
    expect(blindSosReadiness(s, true, 'blind')).toEqual({ acceptedTotal: 1, acceptedReachable: 1 })
  })
})
