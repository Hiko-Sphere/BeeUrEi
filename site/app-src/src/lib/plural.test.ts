import { describe, it, expect } from 'vitest'
import { plural, verbHaveHas } from './plural'

describe('plural（英文单复数，修 "1 contacts"/"1 points"/"1 days" 类语病）', () => {
  it('n=1 单数，其余默认 +s', () => {
    expect(plural(1, 'contact')).toBe('contact')
    expect(plural(0, 'contact')).toBe('contacts')  // 0 复数（英文 "0 contacts"）
    expect(plural(2, 'contact')).toBe('contacts')
    expect(plural(3, 'point')).toBe('points')
    expect(plural(1, 'point')).toBe('point')
    expect(plural(1, 'day')).toBe('day')
    expect(plural(7, 'day')).toBe('days')
  })
  it('不规则复数走 pluralForm', () => {
    expect(plural(1, 'person', 'people')).toBe('person')
    expect(plural(3, 'person', 'people')).toBe('people')
  })
  it('负数按绝对值判定（-1 单数）', () => {
    expect(plural(-1, 'contact')).toBe('contact')
  })
})

describe('verbHaveHas（"1 has" / "N have"）', () => {
  it('1 → has，其余 → have', () => {
    expect(verbHaveHas(1)).toBe('has')
    expect(verbHaveHas(0)).toBe('have')
    expect(verbHaveHas(2)).toBe('have')
  })
})
