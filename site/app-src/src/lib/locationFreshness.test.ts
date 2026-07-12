import { describe, it, expect } from 'vitest'
import { isLocationLive, LIVE_FRESH_MS, isPublishStalled, PUBLISH_STALL_MS } from './locationFreshness'

describe('isLocationLive（实时位置是否仍在活跃更新）', () => {
  const now = 1_000_000

  it('刚上报 / 数秒内 → live（脉动绿点正当其时）', () => {
    expect(isLocationLive(now, now)).toBe(true)
    expect(isLocationLive(now - 8_000, now)).toBe(true)      // 一个上报周期
    expect(isLocationLive(now - LIVE_FRESH_MS, now)).toBe(true) // 恰在阈值上仍算 live
  })

  it('超过阈值（App 很可能已停止上报）→ 非 live（避免假实时绿点）', () => {
    expect(isLocationLive(now - LIVE_FRESH_MS - 1, now)).toBe(false)
    expect(isLocationLive(now - 80_000, now)).toBe(false) // 80s：服务端还没剔除(90s)，但早已不是"实时"
  })

  it('坏值（NaN/±Infinity）不冒充实时', () => {
    expect(isLocationLive(NaN, now)).toBe(false)
    expect(isLocationLive(Infinity, now)).toBe(false)
  })

  it('轻微时钟偏移（updatedAt 略未来）仍算 live（不因偏移误报暂停）', () => {
    expect(isLocationLive(now + 2_000, now)).toBe(true)
  })
})

describe('isPublishStalled（共享者自视：我的上报是否持续送达失败）', () => {
  const now = 2_000_000

  it('未在共享（null）→ 不算停滞', () => {
    expect(isPublishStalled(null, now)).toBe(false)
  })

  it('刚成功上报 / 阈值内 → 不停滞（单次失败不惊扰）', () => {
    expect(isPublishStalled(now, now)).toBe(false)
    expect(isPublishStalled(now - 8_000, now)).toBe(false)              // 一个上报周期
    expect(isPublishStalled(now - PUBLISH_STALL_MS, now)).toBe(false)   // 恰在阈值上仍不警
  })

  it('超过阈值无成功上报（断网等）→ 停滞：界面须警示"联系人可能看不到你"', () => {
    expect(isPublishStalled(now - PUBLISH_STALL_MS - 1, now)).toBe(true)
    expect(isPublishStalled(now - 60_000, now)).toBe(true) // 60s：联系人端 90s 即被剔除，警示须先于消失
  })

  it('坏值（NaN）→ 不误报', () => {
    expect(isPublishStalled(NaN, now)).toBe(false)
  })
})
