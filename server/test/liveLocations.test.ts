import { describe, it, expect } from 'vitest'
import { LiveLocationRegistry } from '../src/location/liveLocations'

describe('LiveLocationRegistry（实时位置共享，纯内存 + TTL）', () => {
  it('update → 共享中且可见；过期后不可见', () => {
    const reg = new LiveLocationRegistry(90_000, 60 * 60_000)
    const t0 = 1_000_000
    const until = reg.update('u1', { lat: 39.9, lng: 116.4, accuracy: 12 }, t0, 1000) // 共享 1s
    expect(until).toBe(t0 + 1000)
    expect(reg.isSharing('u1', t0)).toBe(true)
    expect(reg.visible('u1', t0)?.lat).toBe(39.9)
    // 1s 后共享过期 → 不可见、不在共享。
    expect(reg.isSharing('u1', t0 + 1001)).toBe(false)
    expect(reg.visible('u1', t0 + 1001)).toBeUndefined()
  })

  it('共享中但位置陈旧（超过 freshMs 无更新）→ 不可见（不暴露旧坐标）', () => {
    const reg = new LiveLocationRegistry(90_000, 60 * 60_000)
    const t0 = 2_000_000
    reg.update('u1', { lat: 1, lng: 2 }, t0, 60 * 60_000) // 共享 1 小时
    // 仍在共享期内，但 91s 没有新位置 → 陈旧不可见。
    expect(reg.isSharing('u1', t0 + 91_000)).toBe(true)
    expect(reg.visible('u1', t0 + 91_000)).toBeUndefined()
    // 新位置上报后恢复可见。
    reg.update('u1', { lat: 1.1, lng: 2.1 }, t0 + 91_000, 60 * 60_000)
    expect(reg.visible('u1', t0 + 91_000)?.lat).toBe(1.1)
  })

  it('stop 立即不可见', () => {
    const reg = new LiveLocationRegistry()
    const t0 = 3_000_000
    reg.update('u1', { lat: 1, lng: 2 }, t0)
    expect(reg.visible('u1', t0)).toBeDefined()
    reg.stop('u1')
    expect(reg.visible('u1', t0)).toBeUndefined()
    expect(reg.isSharing('u1', t0)).toBe(false)
  })

  it('ttl 夹取到 maxTtlMs（防"忘记关"无限暴露）', () => {
    const reg = new LiveLocationRegistry(90_000, 10_000) // 上限 10s
    const t0 = 4_000_000
    const until = reg.update('u1', { lat: 1, lng: 2 }, t0, 999_999) // 请求很大 ttl
    expect(until).toBe(t0 + 10_000) // 被夹到上限
  })
})
