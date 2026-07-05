import { describe, it, expect } from 'vitest'
import { qualityFromRtt, qualityFromLoss, qualityFromJitter, qualityFromStats, CallQualityAnnouncer } from './webrtc'

// 阈值直接决定盲人在通话里听到的"信号良好/一般/弱"（CallScreen QualityBars），锁死防回归。
describe('qualityFromRtt 通话质量档（rtt 秒）', () => {
  it('无 rtt → unknown', () => {
    expect(qualityFromRtt(undefined)).toBe('unknown')
  })
  it('<150ms → good（含边界 0 与 0.149）', () => {
    expect(qualityFromRtt(0)).toBe('good')
    expect(qualityFromRtt(0.149)).toBe('good')
  })
  it('[150ms,400ms) → fair（含边界 0.15 与 0.399）', () => {
    expect(qualityFromRtt(0.15)).toBe('fair')
    expect(qualityFromRtt(0.399)).toBe('fair')
  })
  it('≥400ms → weak（含边界 0.4）', () => {
    expect(qualityFromRtt(0.4)).toBe('weak')
    expect(qualityFromRtt(1.2)).toBe('weak')
  })
  it('NaN → weak（保守，不虚报好信号）', () => {
    expect(qualityFromRtt(NaN)).toBe('weak')
  })
})

describe('qualityFromLoss 通话质量档（区间丢包率 0..1）', () => {
  it('无数据/非有限 → unknown（不降级）', () => {
    expect(qualityFromLoss(undefined)).toBe('unknown')
    expect(qualityFromLoss(NaN)).toBe('unknown')
    expect(qualityFromLoss(Infinity)).toBe('unknown')
  })
  it('<3% → good（含边界 0 与 0.029）', () => {
    expect(qualityFromLoss(0)).toBe('good')
    expect(qualityFromLoss(0.029)).toBe('good')
  })
  it('[3%,8%) → fair（含边界 0.03 与 0.079）', () => {
    expect(qualityFromLoss(0.03)).toBe('fair')
    expect(qualityFromLoss(0.079)).toBe('fair')
  })
  it('≥8% → weak（含边界 0.08 与 0.5）', () => {
    expect(qualityFromLoss(0.08)).toBe('weak')
    expect(qualityFromLoss(0.5)).toBe('weak')
  })
  it('负值夹到 0 → good（计数器抖动不虚报差信号）', () => {
    expect(qualityFromLoss(-0.1)).toBe('good')
  })
})

describe('qualityFromJitter 通话质量档（抖动秒）', () => {
  it('无数据/非有限 → unknown（不降级）', () => {
    expect(qualityFromJitter(undefined)).toBe('unknown')
    expect(qualityFromJitter(NaN)).toBe('unknown')
    expect(qualityFromJitter(Infinity)).toBe('unknown')
  })
  it('<30ms → good（含边界 0 与 0.029）', () => {
    expect(qualityFromJitter(0)).toBe('good')
    expect(qualityFromJitter(0.029)).toBe('good')
  })
  it('[30ms,60ms) → fair', () => {
    expect(qualityFromJitter(0.03)).toBe('fair')
    expect(qualityFromJitter(0.059)).toBe('fair')
  })
  it('≥60ms → weak', () => {
    expect(qualityFromJitter(0.06)).toBe('weak')
    expect(qualityFromJitter(0.2)).toBe('weak')
  })
  it('负值夹到 0 → good', () => {
    expect(qualityFromJitter(-0.01)).toBe('good')
  })
})

describe('qualityFromStats 综合档（取 RTT / 丢包 / 抖动最差者）', () => {
  it('三信号皆缺 → unknown', () => {
    expect(qualityFromStats(undefined, undefined, undefined)).toBe('unknown')
    expect(qualityFromStats(undefined, undefined)).toBe('unknown') // jitter 省略=向后兼容
  })
  it('低时延但高丢包 → weak（丢包主导可听度，不因 RTT 低虚报 good）', () => {
    expect(qualityFromStats(0.05, 0.2)).toBe('weak') // 50ms RTT 但 20% 丢包
  })
  it('高时延但零丢包 → weak（时延也拖累）', () => {
    expect(qualityFromStats(0.6, 0)).toBe('weak')
  })
  it('低时延低丢包但高抖动 → weak（抖动独立拖累，不因前两者好虚报 good）', () => {
    expect(qualityFromStats(0.05, 0.01, 0.1)).toBe('weak') // 50ms RTT + 1% 丢包 + 100ms 抖动
  })
  it('三者皆好 → good', () => {
    expect(qualityFromStats(0.05, 0.01, 0.01)).toBe('good')
  })
  it('取更差者：good(rtt)+good(loss)+fair(jitter) → fair', () => {
    expect(qualityFromStats(0.05, 0.01, 0.04)).toBe('fair')
  })
  it('部分信号缺失时以其余有信息者为准（unknown 让位）', () => {
    expect(qualityFromStats(0.05, undefined)).toBe('good')
    expect(qualityFromStats(0.6, undefined)).toBe('weak')
    expect(qualityFromStats(undefined, 0.2)).toBe('weak')
    expect(qualityFromStats(undefined, undefined, 0.1)).toBe('weak') // 只有抖动
  })
})

describe('CallQualityAnnouncer（读屏主动播报去抖，与 iOS 同款）', () => {
  it('转弱须连续确认 confirmations 次才播；已播弱不重复', () => {
    const a = new CallQualityAnnouncer(3)
    expect(a.update('weak')).toBeNull()   // 1
    expect(a.update('weak')).toBeNull()   // 2
    expect(a.update('weak')).toBe('weak') // 3 → 播
    expect(a.update('weak')).toBeNull()   // 已播弱：不重复
  })
  it('从弱恢复须连续确认后才播；起步 good/fair 不播（不表态）', () => {
    const a = new CallQualityAnnouncer(2)
    expect(a.update('good')).toBeNull()   // 起步正常不播
    expect(a.update('fair')).toBeNull()   // fair↔good 不表态
    a.update('weak'); a.update('weak')    // 进入弱（confirmations=2）
    expect(a.update('good')).toBeNull()   // 恢复需确认
    expect(a.update('fair')).toBe('recovered') // 第 2 次非弱 → 恢复
    expect(a.update('good')).toBeNull()   // 已恢复不重复
  })
  it('unknown 中性：不表态、也不清正在累积的确认', () => {
    const a = new CallQualityAnnouncer(3)
    expect(a.update('weak')).toBeNull()    // 1
    expect(a.update('unknown')).toBeNull() // 中性，不推进也不清零
    expect(a.update('weak')).toBeNull()    // 2
    expect(a.update('weak')).toBe('weak')  // 3 → 播（unknown 未打断累积）
  })
  it('抖动打断：转弱累积中途出现好信号 → 清零，须重新连续确认', () => {
    const a = new CallQualityAnnouncer(3)
    a.update('weak'); a.update('weak')     // 累积 2
    expect(a.update('good')).toBeNull()    // 好信号打断 → 清零（且未播过弱，不触发恢复）
    a.update('weak'); a.update('weak')     // 重新 1、2
    expect(a.update('weak')).toBe('weak')  // 3 → 现在才播
  })
})
