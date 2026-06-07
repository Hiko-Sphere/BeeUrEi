import { describe, it, expect } from 'vitest'
import { planEmergencyRoute } from '../src/emergency/routing'
import type { FamilyLink } from '../src/db/store'

function link(id: string, isEmergency: boolean, createdAt: number): FamilyLink {
  return { id, ownerId: 'o', memberId: 'm' + id, relation: 'x', isEmergency, createdAt }
}

describe('planEmergencyRoute', () => {
  it('emergency contacts first, then by createdAt', () => {
    const links = [link('a', false, 100), link('b', true, 200), link('c', true, 50), link('d', false, 10)]
    const ordered = planEmergencyRoute(links).map((l) => l.id)
    expect(ordered).toEqual(['c', 'b', 'd', 'a']) // 紧急(c50,b200) → 非紧急(d10,a100)
  })

  it('does not mutate input', () => {
    const links = [link('a', false, 2), link('b', true, 1)]
    planEmergencyRoute(links)
    expect(links.map((l) => l.id)).toEqual(['a', 'b'])
  })

  it('empty list returns empty', () => {
    expect(planEmergencyRoute([])).toEqual([])
  })
})
