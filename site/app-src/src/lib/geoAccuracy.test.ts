import { describe, it, expect } from 'vitest'
import { validAccuracyMeters, accuracyText } from './geoAccuracy'

const pick = (lang: 'zh' | 'en') => (zh: string, en: string) => (lang === 'zh' ? zh : en)
const t = pick('zh')

describe('geoAccuracy', () => {
  it('validAccuracyMeters：有限正值通过；NaN/Infinity/0/负/缺省 → null', () => {
    expect(validAccuracyMeters(20)).toBe(20)
    expect(validAccuracyMeters(0.5)).toBe(0.5)
    expect(validAccuracyMeters(100000)).toBe(100000) // 服务端上限，画大圈=位置很不准，如实展示
    expect(validAccuracyMeters(0)).toBeNull()
    expect(validAccuracyMeters(-5)).toBeNull()
    expect(validAccuracyMeters(NaN)).toBeNull()
    expect(validAccuracyMeters(Infinity)).toBeNull()
    expect(validAccuracyMeters(null)).toBeNull()
    expect(validAccuracyMeters(undefined)).toBeNull()
  })

  it('accuracyText：四舍五入到米；无效精度 → null', () => {
    expect(accuracyText(19.6, t)).toBe('精确到约 20 米')
    expect(accuracyText(5, t)).toBe('精确到约 5 米')
    expect(accuracyText(999, t)).toBe('精确到约 999 米') // <1km 仍用米
    expect(accuracyText(null, t)).toBeNull()
    expect(accuracyText(0, t)).toBeNull()
    expect(accuracyText(NaN, t)).toBeNull()
  })

  it('accuracyText：≥1km 改用公里，1 位小数去尾零（粗定位/室内网络定位读屏更易懂）', () => {
    expect(accuracyText(1000, t)).toBe('精确到约 1 公里')     // 边界：正好 1km
    expect(accuracyText(1500, t)).toBe('精确到约 1.5 公里')
    expect(accuracyText(2000, t)).toBe('精确到约 2 公里')     // 去尾零：2.0→2
    expect(accuracyText(1050, t)).toBe('精确到约 1.1 公里')   // 四舍五入到 0.1km
    expect(accuracyText(100000, t)).toBe('精确到约 100 公里') // 服务端上限：不再是刺耳的「100000 米」
  })

  it('accuracyText 双语', () => {
    expect(accuracyText(30, pick('en'))).toBe('~30 m accuracy')
    expect(accuracyText(2500, pick('en'))).toBe('~2.5 km accuracy')
  })
})
