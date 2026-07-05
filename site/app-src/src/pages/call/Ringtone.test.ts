// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { Ringtone } from './CallController'

// 来电铃：无用户手势时 AudioContext 生于 suspended 态、静默不响——须显式 resume，否则施救者听不到来电。
const osc = () => ({ frequency: { value: 0 }, type: '', connect: () => {}, start: () => {}, stop: () => {} })
const gain = () => ({ gain: { setValueAtTime: () => {}, linearRampToValueAtTime: () => {} }, connect: () => {} })

describe('Ringtone', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('start() 响铃时 resume AudioContext（防 suspended 态静默）', () => {
    const resume = vi.fn(() => Promise.resolve())
    class MockCtx {
      currentTime = 0
      destination = {}
      resume = resume
      close = () => Promise.resolve()
      createOscillator() { return osc() }
      createGain() { return gain() }
    }
    vi.stubGlobal('AudioContext', MockCtx)
    const r = new Ringtone()
    r.start()
    expect(resume).toHaveBeenCalled() // 首拍 beep 即 resume，否则 suspended 态铃声不响
    r.stop() // 清定时器，避免泄漏到其它用例
  })
})
