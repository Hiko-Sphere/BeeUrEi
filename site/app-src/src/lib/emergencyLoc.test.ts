import { describe, it, expect } from 'vitest'
import { emergencyLocInfo } from './emergencyLoc'

describe('emergencyLocInfo（紧急告警位置的诚实标注）', () => {
  const createdAt = 1_700_000_000_000

  it('lastKnown + ageSec：stale 且给出绝对定位时刻（= 告警时刻 − age）', () => {
    const r = emergencyLocInfo({ locSource: 'lastKnown', locAgeSec: '300' }, createdAt)
    expect(r.stale).toBe(true)
    expect(r.fixAt).toBe(createdAt - 300_000) // 5 分钟前的定位
  })

  it('live 实时定位：不标 stale（保持"查看位置"）', () => {
    expect(emergencyLocInfo({ locSource: 'live' }, createdAt)).toEqual({ stale: false, fixAt: null })
  })

  it('旧版服务端无 locSource 字段：按实时处理（向后兼容，不误标）', () => {
    expect(emergencyLocInfo({ lat: '31.2', lon: '121.5' }, createdAt)).toEqual({ stale: false, fixAt: null })
    expect(emergencyLocInfo(undefined, createdAt)).toEqual({ stale: false, fixAt: null })
  })

  it('lastKnown 但 ageSec 缺失/坏值/负值：仍如实标 stale，只是不给定位时刻', () => {
    expect(emergencyLocInfo({ locSource: 'lastKnown' }, createdAt)).toEqual({ stale: true, fixAt: null })
    expect(emergencyLocInfo({ locSource: 'lastKnown', locAgeSec: 'xx' }, createdAt)).toEqual({ stale: true, fixAt: null })
    expect(emergencyLocInfo({ locSource: 'lastKnown', locAgeSec: '-5' }, createdAt)).toEqual({ stale: true, fixAt: null })
  })

  it('ageSec=0（刚定位就丢了 GPS）：stale 且 fixAt=告警时刻', () => {
    expect(emergencyLocInfo({ locSource: 'lastKnown', locAgeSec: '0' }, createdAt)).toEqual({ stale: true, fixAt: createdAt })
  })

  it('createdAt 非有限（坏通知记录）或 fixAt 溢出：只标 stale、不给坏时刻（与 iOS EmergencyLocationTag 同口径）', () => {
    // 坏通知 createdAt=NaN：不给时刻（否则 fixAt=NaN 被下游渲染成 Invalid Date）。
    expect(emergencyLocInfo({ locSource: 'lastKnown', locAgeSec: '300' }, NaN)).toEqual({ stale: true, fixAt: null })
    // age 巨值致 createdAt − age*1000 溢出为 -Infinity：只标 stale、不给时刻。
    expect(emergencyLocInfo({ locSource: 'lastKnown', locAgeSec: '1e306' }, createdAt)).toEqual({ stale: true, fixAt: null })
  })
})
