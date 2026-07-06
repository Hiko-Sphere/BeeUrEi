import { describe, it, expect } from 'vitest'
import { emergencyDirection } from './emergencyRelation'

describe('emergencyDirection：紧急联系人关系方向', () => {
  it('非紧急 → none（无论谁 owner）', () => {
    expect(emergencyDirection(false, true)).toBe('none')
    expect(emergencyDirection(false, false)).toBe('none')
    expect(emergencyDirection(undefined, true)).toBe('none')
  })
  it('我是 owner + 紧急 → theyAreMine（对方是我的紧急联系人）', () => {
    expect(emergencyDirection(true, true)).toBe('theyAreMine')
  })
  it('对方是 owner + 紧急 → iAmTheirs（我是对方的紧急联系人，我对 TA 负责）', () => {
    expect(emergencyDirection(true, false)).toBe('iAmTheirs')
  })
  it('amOwner 缺失（老数据）+ 紧急 → 回退 theyAreMine，不做方向性断言', () => {
    expect(emergencyDirection(true, undefined)).toBe('theyAreMine')
  })
})
