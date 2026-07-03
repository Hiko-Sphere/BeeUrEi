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

describe('lastKnownForEmergency（紧急告警位置兜底）', () => {
  const FRESH = 90_000, TTL = 60 * 60_000, EMG = 15 * 60_000
  it('共享中但已超新鲜窗（visible 拒）→ 紧急兜底仍返回最后位置（家人最需要之时）', () => {
    const reg = new LiveLocationRegistry(FRESH, TTL, EMG)
    const t0 = 5_000_000
    reg.update('u1', { lat: 31.2, lng: 121.5 }, t0, TTL) // 长共享窗
    const t1 = t0 + 5 * 60_000 // 5 分钟后无新位置：超 90s 新鲜窗
    expect(reg.visible('u1', t1)).toBeUndefined()             // 实时地图正确地不显示陈旧点
    const last = reg.lastKnownForEmergency('u1', t1)
    expect(last?.lat).toBe(31.2)                              // 但紧急兜底给出最后已知
    expect(last?.updatedAt).toBe(t0)                          // 带原始时刻，供标注"N 分钟前"
  })
  it('共享已结束（sharingUntil 过） → 紧急兜底也不返回（尊重"停止=消失"，不复活轨迹）', () => {
    const reg = new LiveLocationRegistry(FRESH, TTL, EMG)
    const t0 = 5_000_000
    reg.update('u1', { lat: 31.2, lng: 121.5 }, t0, 30_000) // 仅共享 30s
    expect(reg.lastKnownForEmergency('u1', t0 + 31_000)).toBeUndefined()
  })
  it('超过紧急陈旧上限（>emergencyMaxAge）→ 不返回（过老无意义且可能误导）', () => {
    const reg = new LiveLocationRegistry(FRESH, TTL, EMG)
    const t0 = 5_000_000
    reg.update('u1', { lat: 31.2, lng: 121.5 }, t0, TTL)
    expect(reg.lastKnownForEmergency('u1', t0 + EMG + 1)).toBeUndefined() // 15分01秒
    expect(reg.lastKnownForEmergency('u1', t0 + EMG)).toBeDefined()       // 恰 15 分含
  })
  it('主动 stop 后紧急兜底不返回', () => {
    const reg = new LiveLocationRegistry(FRESH, TTL, EMG)
    const t0 = 5_000_000
    reg.update('u1', { lat: 31.2, lng: 121.5 }, t0, TTL)
    reg.stop('u1')
    expect(reg.lastKnownForEmergency('u1', t0 + 1000)).toBeUndefined()
  })
})
