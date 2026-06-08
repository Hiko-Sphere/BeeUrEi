import { describe, it, expect } from 'vitest'
import { PresenceRegistry } from '../src/assist/presence'

describe('PresenceRegistry', () => {
  it('available within TTL, expires after', () => {
    const p = new PresenceRegistry(45_000)
    p.heartbeat('u', true, 0, 0)
    expect(p.isAvailable('u', 10_000)).toBe(true)
    expect(p.isAvailable('u', 50_000)).toBe(false)
  })

  it('ignores out-of-order stale heartbeats (见审查 #1)', () => {
    const p = new PresenceRegistry(45_000)
    // 切页：先发 false(seq=1) 再发 true(seq=2)，但 false 的网络往返更慢、后到达。
    p.heartbeat('u', true, 100, 2)   // appear(true) 先被应用
    p.heartbeat('u', false, 100, 1)  // 滞后到达的 offline(seq 更小) → 必须忽略
    expect(p.isAvailable('u', 100)).toBe(true) // 仍在线，不被过期心跳错标离线
  })

  it('newer offline does take effect', () => {
    const p = new PresenceRegistry(45_000)
    p.heartbeat('u', true, 0, 1)
    p.heartbeat('u', false, 0, 2) // 更新的下线生效
    expect(p.isAvailable('u', 0)).toBe(false)
  })
})
