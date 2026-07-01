import { describe, it, expect } from 'vitest'
import { qualityFromRtt } from './webrtc'

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
