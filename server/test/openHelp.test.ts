import { describe, it, expect } from 'vitest'
import { OpenHelpRegistry, type HelpRequest } from '../src/assist/openHelp'

describe('OpenHelpRegistry', () => {
  const base = (over: Partial<HelpRequest> = {}): HelpRequest => ({
    callId: over.callId ?? 'h1',
    fromUserId: over.fromUserId ?? 'blind1',
    fromName: over.fromName ?? '小明',
    language: over.language,
    locality: over.locality,
    topic: over.topic,
    createdAt: over.createdAt ?? 0,
    claimedBy: over.claimedBy,
    claimedAt: over.claimedAt,
  })

  it('登记后出现在公开队列，按等待时间最久优先', () => {
    const r = new OpenHelpRegistry()
    r.register(base({ callId: 'new', createdAt: 20 }))
    r.register(base({ callId: 'old', createdAt: 10 }))
    expect(r.open(30).map((x) => x.callId)).toEqual(['old', 'new'])
  })

  it('队列摘要排除请求者本人，含等待秒数', () => {
    const r = new OpenHelpRegistry()
    r.register(base({ callId: 'mine', fromUserId: 'me', createdAt: 0, language: 'zh', locality: '北京市', topic: '看一下药盒' }))
    r.register(base({ callId: 'other', fromUserId: 'someone', createdAt: 0 }))
    const list = r.summaries(5000, 'me')
    expect(list.map((s) => s.callId)).toEqual(['other']) // 自己的不展示给自己
    const mineForOthers = r.summaries(5000, 'stranger')
    const mine = mineForOthers.find((s) => s.callId === 'mine')!
    expect(mine.waitedSeconds).toBe(5)
    expect(mine.locality).toBe('北京市')
    expect(mine.topic).toBe('看一下药盒')
    // 摘要不泄露 fromUserId（隐私）
    expect((mine as { fromUserId?: unknown }).fromUserId).toBeUndefined()
  })

  it('register 拒绝覆盖他人的 callId', () => {
    const r = new OpenHelpRegistry()
    expect(r.register(base({ callId: 'c', fromUserId: 'A' }))).toBe(true)
    expect(r.register(base({ callId: 'c', fromUserId: 'attacker' }))).toBe(false)
    // 同发起人可更新自己的
    expect(r.register(base({ callId: 'c', fromUserId: 'A', topic: '改了' }))).toBe(true)
  })

  it('claim 原子认领：一条求助只能被一位志愿者拿到', () => {
    const r = new OpenHelpRegistry()
    r.register(base({ callId: 'c', fromUserId: 'blind1' }))
    expect(r.claim('c', 'helperA', 0)?.claimedBy).toBe('helperA')
    expect(r.claim('c', 'helperB', 0)).toBeNull() // 已被 A 认领
    expect(r.claim('c', 'helperA', 0)?.claimedBy).toBe('helperA') // 同一人幂等
    // 认领后从公开队列消失
    expect(r.open(0).length).toBe(0)
  })

  it('不能认领自己的求助', () => {
    const r = new OpenHelpRegistry()
    r.register(base({ callId: 'c', fromUserId: 'blind1' }))
    expect(r.claim('c', 'blind1', 0)).toBeNull()
  })

  it('claim 不存在的求助返回 null', () => {
    const r = new OpenHelpRegistry()
    expect(r.claim('nope', 'helperA', 0)).toBeNull()
  })

  it('matchOne：偏好语言优先，其次等待最久', () => {
    const r = new OpenHelpRegistry()
    r.register(base({ callId: 'enOld', fromUserId: 'b1', language: 'en', createdAt: 0 }))
    r.register(base({ callId: 'zhNew', fromUserId: 'b2', language: 'zh', createdAt: 10 }))
    r.register(base({ callId: 'zhOld', fromUserId: 'b3', language: 'zh', createdAt: 5 }))
    const m = r.matchOne({ preferredLanguage: 'zh' }, 'helperA', 100)
    expect(m?.callId).toBe('zhOld') // zh 里等待最久者
    expect(m?.claimedBy).toBe('helperA') // 已被认领
  })

  it('matchOne requireLanguageMatch：无匹配返回 null', () => {
    const r = new OpenHelpRegistry()
    r.register(base({ callId: 'c', fromUserId: 'b1', language: 'en' }))
    expect(r.matchOne({ preferredLanguage: 'zh', requireLanguageMatch: true }, 'helperA', 0)).toBeNull()
    // 不强制匹配则仍能拿到
    expect(r.matchOne({ preferredLanguage: 'zh' }, 'helperA', 0)?.callId).toBe('c')
  })

  it('matchOne 在认领竞争失败时取下一个可认领者', () => {
    const r = new OpenHelpRegistry()
    r.register(base({ callId: 'taken', fromUserId: 'b1', createdAt: 0 }))
    r.register(base({ callId: 'free', fromUserId: 'b2', createdAt: 5 }))
    r.claim('taken', 'someoneElse', 0) // 已被别人认领
    const m = r.matchOne({}, 'helperA', 100)
    expect(m?.callId).toBe('free') // 跳过已被认领的，拿到 free
  })

  it('participants：认领前仅求助者，认领后含认领者', () => {
    const r = new OpenHelpRegistry()
    r.register(base({ callId: 'c', fromUserId: 'blind1' }))
    expect(r.participants('c')).toEqual(['blind1'])
    r.claim('c', 'helperA', 0)
    expect(r.participants('c')).toEqual(['blind1', 'helperA'])
    expect(r.participants('missing')).toBeNull()
  })

  it('cancel：求助者删整条；认领者放弃则释放回队列', () => {
    const r = new OpenHelpRegistry()
    r.register(base({ callId: 'c', fromUserId: 'blind1' }))
    r.claim('c', 'helperA', 0)
    expect(r.cancel('c', 'stranger')).toBe(false) // 无关者不可取消
    expect(r.cancel('c', 'helperA')).toBe(true) // 认领者放弃
    expect(r.open(0).map((x) => x.callId)).toEqual(['c']) // 释放回公开队列
    expect(r.cancel('c', 'blind1')).toBe(true) // 求助者撤销
    expect(r.byId('c')).toBeUndefined()
  })

  it('未认领求助按 TTL 过期；已认领条目保留更久', () => {
    const r = new OpenHelpRegistry(60_000, 4 * 60 * 60 * 1000)
    r.register(base({ callId: 'pending', fromUserId: 'b1', createdAt: 0 }))
    r.register(base({ callId: 'claimed', fromUserId: 'b2', createdAt: 0 }))
    r.claim('claimed', 'helperA', 0)
    // t=61s：未认领的过期，已认领的仍在
    expect(r.open(61_000).length).toBe(0)
    expect(r.byId('claimed')).toBeDefined()
    expect(r.participants('claimed')).toEqual(['b2', 'helperA'])
    // 已认领条目在 claimedTtl 后过期
    expect(r.byId('claimed')).toBeDefined()
    r.open(4 * 60 * 60 * 1000 + 1) // 触发 prune
    expect(r.byId('claimed')).toBeUndefined()
  })

  it('硬上限：超出淘汰最旧', () => {
    const r = new OpenHelpRegistry(120_000, 1000, 3)
    for (let i = 0; i < 5; i++) r.register(base({ callId: `c${i}`, fromUserId: `b${i}`, createdAt: i }))
    expect(r.size).toBeLessThanOrEqual(3)
    expect(r.byId('c0')).toBeUndefined() // 最旧被淘汰
    expect(r.byId('c4')).toBeDefined()
  })
})
