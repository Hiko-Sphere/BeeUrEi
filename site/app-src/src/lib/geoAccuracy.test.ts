import { describe, it, expect } from 'vitest'
import { validAccuracyMeters, accuracyText, shareAccuracyNote, COARSE_ACCURACY_M } from './geoAccuracy'

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
    // 跨端一致基准（iOS SharedLocationAccuracy 对齐**这些值**；对原始值判档/舍入，而非先取整成米）：
    expect(accuracyText(999.6, t)).toBe('精确到约 1000 米')   // <1km 仍归米档（不因 round→1000 跳到公里）
    expect(accuracyText(1449.6, t)).toBe('精确到约 1.4 公里') // round(14.496)=14 → 1.4（非二次舍入的 1.5）
  })

  it('accuracyText 双语', () => {
    expect(accuracyText(30, pick('en'))).toBe('~30 m accuracy')
    expect(accuracyText(2500, pick('en'))).toBe('~2.5 km accuracy')
  })

  it('accuracyText 英制单位（英尺/英里，与 iOS 距离单位设置对齐）', () => {
    expect(accuracyText(20, pick('en'), 'imperial')).toBe('~66 ft accuracy')    // 20m≈66ft
    expect(accuracyText(20, t, 'imperial')).toBe('精确到约 66 英尺')
    expect(accuracyText(1500, pick('en'), 'imperial')).toBe('~0.9 mi accuracy') // 1500m≈0.9mi
    // 公制默认（不传 unit）逐字不变，回归守卫。
    expect(accuracyText(20, t)).toBe('精确到约 20 米')
    // shareAccuracyNote 同样随单位。
    expect(shareAccuracyNote(30, pick('en'), 'imperial')?.text).toBe('~98 ft accuracy') // 30m≈98ft，<500m 不粗略
  })

  it('shareAccuracyNote（共享者自视）：街道级只报精度、不告警；粗定位加"只看到大致区域"', () => {
    // 街道级（< 500m）：coarse=false，文字即精度本身。
    const good = shareAccuracyNote(30, t)
    expect(good).toEqual({ text: '精确到约 30 米', coarse: false })
    // 边界：499 街道级、500 起粗定位（阈值 COARSE_ACCURACY_M）。
    expect(shareAccuracyNote(COARSE_ACCURACY_M - 1, t)?.coarse).toBe(false)
    const coarse = shareAccuracyNote(COARSE_ACCURACY_M, t)
    expect(coarse?.coarse).toBe(true)
    expect(coarse?.text).toContain('联系人只看到大致区域') // 粗定位如实告知
    expect(coarse?.text).toContain('精确到约 500 米')       // 500m<1km 仍用米，且精度文字嵌在提示里
  })

  it('shareAccuracyNote：无有效精度 → null（不显示、不报假数字）', () => {
    expect(shareAccuracyNote(null, t)).toBeNull()
    expect(shareAccuracyNote(undefined, t)).toBeNull()
    expect(shareAccuracyNote(0, t)).toBeNull()
    expect(shareAccuracyNote(NaN, t)).toBeNull()
  })

  it('shareAccuracyNote 双语（粗定位英文文案）', () => {
    const en = shareAccuracyNote(3000, pick('en'))
    expect(en?.coarse).toBe(true)
    expect(en?.text).toBe('~3 km accuracy · coarse — contacts see only an approximate area')
  })
})
