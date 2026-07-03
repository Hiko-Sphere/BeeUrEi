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

  it('同毫秒同紧急标记按 id 稳定排序（不依赖输入序，两存储部署下一致）', () => {
    // 同 createdAt 同 isEmergency：须按 id 确定序，否则输入序不同（Memory 插入序 vs Sqlite ORDER BY）
    // 会让紧急呼叫顺序在两部署间漂移。倒序输入也应得到 id 升序输出。
    const links = [link('z', true, 100), link('a', true, 100), link('m', true, 100)]
    expect(planEmergencyRoute(links).map((l) => l.id)).toEqual(['a', 'm', 'z'])
    // 紧急优先仍压倒 id：非紧急 'a' 不得排到紧急 'z' 前。
    const mixed = [link('a', false, 100), link('z', true, 100)]
    expect(planEmergencyRoute(mixed).map((l) => l.id)).toEqual(['z', 'a'])
  })

  // MARK: 在线优先（遇险先接通此刻真正待命的人）

  it('同信任层级内在线者优先（遇险不在离线联系人上白等振铃）', () => {
    // 两个都是紧急联系人，a 更早添加但离线，b 在线 → b 应排前（同层级内在线优先压倒 createdAt）。
    const links = [link('a', true, 100), link('b', true, 200)]
    const onlineB = (mid: string) => mid === 'mb' // link('b') 的 memberId = 'mb'
    expect(planEmergencyRoute(links, onlineB).map((l) => l.id)).toEqual(['b', 'a'])
    // 无在线加权时退回 createdAt 序（a 早于 b）——证明在线才是造成差异的原因。
    expect(planEmergencyRoute(links).map((l) => l.id)).toEqual(['a', 'b'])
  })

  it('在线只在层级内加权，不跨层级：离线紧急联系人仍排在在线非紧急联系人之前', () => {
    // e=紧急但离线，n=非紧急但在线。用户显式指定的信任层级应主导，不被在线与否颠覆。
    const links = [link('n', false, 50), link('e', true, 100)]
    const onlineN = (mid: string) => mid === 'mn'
    expect(planEmergencyRoute(links, onlineN).map((l) => l.id)).toEqual(['e', 'n'])
  })

  it('同层级同在线状态仍按 (createdAt,id) 稳定排序', () => {
    // 都在线、都紧急 → 在线键不产生差异，退回 createdAt 再 id，保持确定序。
    const links = [link('z', true, 100), link('a', true, 100)]
    const allOnline = () => true
    expect(planEmergencyRoute(links, allOnline).map((l) => l.id)).toEqual(['a', 'z'])
  })
})
