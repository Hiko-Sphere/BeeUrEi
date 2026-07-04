import { describe, it, expect } from 'vitest'
import { evaluateGeofences } from '../src/location/geofence'
import { type SavedPlace } from '../src/db/store'

// 家在 (39.9042, 116.4074)。
const home: SavedPlace = { ownerId: 'u', label: 'home', address: '家', lat: 39.9042, lng: 116.4074, updatedAt: 0 }
// 约 1km 外的一点（同纬度 +0.012 经度 ≈ 1km）。
const farAway = { lat: 39.9042, lon: 116.4074 + 0.012 }
const atHome = { lat: 39.9042, lon: 116.4074 }
// 边界内外：enter=150m。约 100m（+0.0012 经度）→ 内；约 180m（+0.0021 经度）→ enter 外、exit 内。
const near100 = { lat: 39.9042, lon: 116.4074 + 0.0012 }
const between = { lat: 39.9042, lon: 116.4074 + 0.0021 }

describe('geofence 到达围栏', () => {
  it('外→内：进入 enterRadius 触发"新到达"', () => {
    const r = evaluateGeofences(atHome, [home], new Set())
    expect(r.arrived.map((p) => p.label)).toEqual(['home'])
    expect(r.insideLabels).toEqual(['home'])
  })

  it('停留在内：不重复触发（去重）', () => {
    const r = evaluateGeofences(atHome, [home], new Set(['home']))
    expect(r.arrived).toEqual([]) // 已在内，非新到达
    expect(r.insideLabels).toEqual(['home'])
  })

  it('远处：不在内、不触发', () => {
    const r = evaluateGeofences(farAway, [home], new Set())
    expect(r.arrived).toEqual([])
    expect(r.insideLabels).toEqual([])
  })

  it('滞回：之前在内、现处 enter 与 exit 之间 → 仍算在内（不误报离开再到达）', () => {
    // between ≈ 180m：>enter(150) 但 <exit(200)。之前在内 → 仍在内、不算新到达。
    const r = evaluateGeofences(between, [home], new Set(['home']))
    expect(r.arrived).toEqual([])
    expect(r.insideLabels).toEqual(['home'])
    // 但之前在外、同一点 → enter(150) 外 → 不算入（滞回不对称）。
    const r2 = evaluateGeofences(between, [home], new Set())
    expect(r2.insideLabels).toEqual([])
  })

  it('near100 之前在外 → 进入 enter(150) → 新到达', () => {
    const r = evaluateGeofences(near100, [home], new Set())
    expect(r.arrived.map((p) => p.label)).toEqual(['home'])
  })

  it('无坐标的地点跳过；坏定位保持原状', () => {
    const noCoord: SavedPlace = { ownerId: 'u', label: 'work', address: '公司', updatedAt: 0 }
    expect(evaluateGeofences(atHome, [noCoord], new Set()).arrived).toEqual([])
    const bad = evaluateGeofences({ lat: NaN, lon: NaN }, [home], new Set(['home']))
    expect(bad.arrived).toEqual([])
    expect(bad.insideLabels).toEqual(['home']) // 坏定位保持原状，不误报离开
  })
})
