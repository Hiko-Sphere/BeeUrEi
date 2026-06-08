import { describe, it, expect } from 'vitest'
import { rankHelpers, type Candidate } from '../src/assist/matcher'

const base: Candidate = { userId: 'x', online: true, isEmergency: false, load: 0 }

describe('rankHelpers', () => {
  it('excludes offline candidates', () => {
    const r = rankHelpers([{ ...base, userId: 'on' }, { ...base, userId: 'off', online: false }], { emergency: false })
    expect(r.map((c) => c.userId)).toEqual(['on'])
  })

  it('emergency contacts rank first in emergency', () => {
    const r = rankHelpers(
      [{ ...base, userId: 'normal' }, { ...base, userId: 'em', isEmergency: true }],
      { emergency: true },
    )
    expect(r[0].userId).toBe('em')
  })

  it('prefers lower load', () => {
    const r = rankHelpers(
      [{ ...base, userId: 'busy', load: 3 }, { ...base, userId: 'free', load: 0 }],
      { emergency: false },
    )
    expect(r[0].userId).toBe('free')
  })

  it('language match adds preference', () => {
    const r = rankHelpers(
      [{ ...base, userId: 'en', language: 'en' }, { ...base, userId: 'zh', language: 'zh' }],
      { emergency: false, preferredLanguage: 'zh' },
    )
    expect(r[0].userId).toBe('zh')
  })
})
