import { describe, it, expect } from 'vitest'
import { qualityFromRtt, qualityFromLoss, qualityFromStats } from './webrtc'

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

describe('qualityFromStats 综合档（取 RTT 与丢包更差者）', () => {
  it('两信号皆缺 → unknown', () => {
    expect(qualityFromStats(undefined, undefined)).toBe('unknown')
  })
  it('低时延但高丢包 → weak（丢包主导可听度，不因 RTT 低虚报 good）', () => {
    expect(qualityFromStats(0.05, 0.2)).toBe('weak') // 50ms RTT 但 20% 丢包
  })
  it('高时延但零丢包 → weak（时延也拖累）', () => {
    expect(qualityFromStats(0.6, 0)).toBe('weak')
  })
  it('两者皆好 → good', () => {
    expect(qualityFromStats(0.05, 0.01)).toBe('good')
  })
  it('取更差者：good(rtt)+fair(loss) → fair', () => {
    expect(qualityFromStats(0.05, 0.05)).toBe('fair')
  })
  it('丢包无数据时以 RTT 为准（unknown 让位）', () => {
    expect(qualityFromStats(0.05, undefined)).toBe('good')
    expect(qualityFromStats(0.6, undefined)).toBe('weak')
  })
  it('RTT 无数据时以丢包为准', () => {
    expect(qualityFromStats(undefined, 0.2)).toBe('weak')
    expect(qualityFromStats(undefined, 0.01)).toBe('good')
  })
})
