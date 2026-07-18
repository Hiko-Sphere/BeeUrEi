import { describe, it, expect } from 'vitest'
import { medicalStalenessCaution, medicalStalenessSelfReminder } from './medicalStaleness'

const DAY = 86_400_000
const NOW = 1_700_000_000_000 // 固定 now，边界不受机器时钟影响

describe('medicalStalenessCaution 施救者侧医疗信息陈旧警示', () => {
  it('未达 1 年阈值 → null（不打扰）：200 天 / 364 天 / 恰好 365 天前一刻', () => {
    expect(medicalStalenessCaution(NOW - 200 * DAY, NOW, 'zh')).toBeNull()
    expect(medicalStalenessCaution(NOW - 364 * DAY, NOW, 'zh')).toBeNull()
    expect(medicalStalenessCaution(NOW - (365 * DAY - 1), NOW, 'zh')).toBeNull()
  })
  it('恰好 365 天 → 12 个月（max(12,·) 兜底，不显示 <12）', () => {
    const s = medicalStalenessCaution(NOW - 365 * DAY, NOW, 'zh')
    expect(s).toContain('12 个月')
  })
  it('400 天 → 13 个月，含可行动"再确认"，含 ⚠️', () => {
    const s = medicalStalenessCaution(NOW - 400 * DAY, NOW, 'zh')
    expect(s).toContain('13 个月')
    expect(s).toContain('再确认')
    expect(s).toContain('⚠️')
  })
  it('730 天 → 24 个月', () => {
    expect(medicalStalenessCaution(NOW - 730 * DAY, NOW, 'zh')).toContain('24 个月')
  })
  it('非有限（NaN/Infinity）→ null，绝不渲染 "NaN 个月"', () => {
    expect(medicalStalenessCaution(NaN, NOW, 'zh')).toBeNull()
    expect(medicalStalenessCaution(NOW - 400 * DAY, NaN, 'zh')).toBeNull()
    expect(medicalStalenessCaution(-Infinity, NOW, 'zh')).toBeNull()
  })
  it('英文文案不串中文、含 "Confirm" 可行动指引', () => {
    const s = medicalStalenessCaution(NOW - 400 * DAY, NOW, 'en')
    expect(s).toContain('13 months')
    expect(s).toContain('Confirm')
    expect(s).not.toMatch(/[一-鿿]/)
  })
  it('未来时间戳（now 之前尚未更新，负天数）→ null 不误报', () => {
    expect(medicalStalenessCaution(NOW + 10 * DAY, NOW, 'zh')).toBeNull()
  })
})

describe('medicalStalenessSelfReminder 本人侧复核提醒（与 iOS 填写者侧同口径）', () => {
  it('未达阈值 → null：200 / 364 / 恰好 365 天前一刻', () => {
    expect(medicalStalenessSelfReminder(NOW - 200 * DAY, NOW, 'zh')).toBeNull()
    expect(medicalStalenessSelfReminder(NOW - 364 * DAY, NOW, 'zh')).toBeNull()
    expect(medicalStalenessSelfReminder(NOW - (365 * DAY - 1), NOW, 'zh')).toBeNull()
  })
  it('400 天 → 13 个月，含可行动"建议复核"，措辞面向本人（"你的信息"而非"施救前确认"）', () => {
    const s = medicalStalenessSelfReminder(NOW - 400 * DAY, NOW, 'zh')
    expect(s).toContain('13 个月')
    expect(s).toContain('建议复核')
    expect(s).not.toContain('施救前') // 本人侧措辞，不串施救者侧
  })
  it('730 天 → 24 个月；365 天恰好 → 12 个月（max 兜底）', () => {
    expect(medicalStalenessSelfReminder(NOW - 730 * DAY, NOW, 'zh')).toContain('24 个月')
    expect(medicalStalenessSelfReminder(NOW - 365 * DAY, NOW, 'zh')).toContain('12 个月')
  })
  it('非有限 / 未来时间戳 → null', () => {
    expect(medicalStalenessSelfReminder(NaN, NOW, 'zh')).toBeNull()
    expect(medicalStalenessSelfReminder(NOW + 10 * DAY, NOW, 'zh')).toBeNull()
  })
  it('英文不串中文、含 "review"', () => {
    const s = medicalStalenessSelfReminder(NOW - 400 * DAY, NOW, 'en')
    expect(s).toContain('13 months')
    expect(s).toContain('review')
    expect(s).not.toMatch(/[一-鿿]/)
  })
})
