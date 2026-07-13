import { describe, it, expect } from 'vitest'
import { insertWaypoint, type LatLng } from './routeEdit'

const P = (n: number) => ({ lat: n, lng: n })

describe('insertWaypoint（路线中段补点）', () => {
  it('未选中 → 追加到末尾，并选中新点', () => {
    const r = insertWaypoint([P(1), P(2)], P(9), null)
    expect(r.waypoints.map((w) => w.lat)).toEqual([1, 2, 9])
    expect(r.selectedIdx).toBe(2)
  })

  it('选中末尾点 → 仍追加（画线时每次追加后选中末点，行为与旧版一致）', () => {
    const r = insertWaypoint([P(1), P(2), P(3)], P(9), 2) // 选中末点 idx=2
    expect(r.waypoints.map((w) => w.lat)).toEqual([1, 2, 3, 9])
    expect(r.selectedIdx).toBe(3)
  })

  it('选中中段点 → 插到它之后，并选中刚插入的点', () => {
    const r = insertWaypoint([P(1), P(2), P(3), P(4)], P(9), 1) // 选中 idx=1(值2)
    expect(r.waypoints.map((w) => w.lat)).toEqual([1, 2, 9, 3, 4])
    expect(r.selectedIdx).toBe(2)
  })

  it('选中起点(非末尾) → 插到起点之后', () => {
    const r = insertWaypoint([P(1), P(2), P(3)], P(9), 0)
    expect(r.waypoints.map((w) => w.lat)).toEqual([1, 9, 2, 3])
    expect(r.selectedIdx).toBe(1)
  })

  it('空序列 → 追加为第一个点', () => {
    const r = insertWaypoint([], P(9), null)
    expect(r.waypoints.map((w) => w.lat)).toEqual([9])
    expect(r.selectedIdx).toBe(0)
  })

  it('保留 note 等附加字段（泛型不丢字段）', () => {
    const wps: LatLng[] = [{ lat: 1, lng: 1, note: '起点' }, { lat: 2, lng: 2, note: '终点' }]
    const r = insertWaypoint(wps, { lat: 9, lng: 9 }, 0)
    expect(r.waypoints[0].note).toBe('起点')
    expect(r.waypoints[2].note).toBe('终点')
    expect(r.waypoints[1].note).toBeUndefined()
  })

  it('越界/负的 selectedIdx 兜底为追加（不崩、不错插）', () => {
    expect(insertWaypoint([P(1), P(2)], P(9), 5).waypoints.map((w) => w.lat)).toEqual([1, 2, 9])
    expect(insertWaypoint([P(1), P(2)], P(9), -1).waypoints.map((w) => w.lat)).toEqual([1, 2, 9])
  })
})
