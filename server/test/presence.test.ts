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

  it('机会式剪枝：表超阈值时清掉久未心跳的陈旧条目，不再无界增长（内存泄漏防护）', () => {
    // ttl=45s，剪枝宽限=100ms，阈值=3：便于用小规模触发。
    const p = new PresenceRegistry(45_000, 100, 3)
    p.heartbeat('old1', true, 0)
    p.heartbeat('old2', false, 0) // 下线用户旧实现也常驻 lastSeq——这里同样应被剪
    expect(p.size).toBe(2)
    // 远超宽限(100ms)后有新用户心跳、且表将超阈值 → 触发清扫，old1/old2(seenAt=0，now-0>100)被剪。
    p.heartbeat('new1', true, 10_000)
    p.heartbeat('new2', true, 10_000) // size 触及 3>阈值 → 清扫陈旧
    expect(p.size).toBe(2) // 只剩两个新用户；old1/old2 已剪
    expect(p.isAvailable('new1', 10_000)).toBe(true)
    expect(p.isAvailable('old1', 10_000)).toBe(false) // 早已 TTL 过期，剪除后仍不可用（行为不变）
  })

  it('剪枝不误伤仍在宽限内的用户（seenAt 尚新则保留，其 seq 去抖仍有效）', () => {
    const p = new PresenceRegistry(45_000, 100, 1) // 阈值=1：下一个用户加入即触发清扫
    p.heartbeat('u', true, 1000, 5) // u seenAt=1000
    // v 于 1050 心跳 → size=2>1 触发清扫；u 才过 50ms(<宽限100ms) → 不被剪。
    p.heartbeat('v', true, 1050)
    expect(p.isAvailable('u', 1050)).toBe(true) // u 未被误剪
    expect(p.size).toBe(2)
    // u 的 seq 去抖仍有效：滞后的小 seq offline 被丢弃。
    p.heartbeat('u', false, 1060, 3) // seq=3 < 5 → 丢弃
    expect(p.isAvailable('u', 1060)).toBe(true)
  })
})
