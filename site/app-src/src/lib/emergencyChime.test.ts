// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { playEmergencyChime } from './emergencyAlerts'

// 紧急提示音：现代浏览器无用户手势时 AudioContext 生于 suspended 态、静默不发声——须显式 resume。
// 施救者可能没盯屏、全靠这声注意到求助，故务必尽力让它响。
const node = () => ({ connect: (n: unknown) => n, start: () => {}, stop: () => {}, type: '', frequency: { value: 0 } })
const gainNode = () => ({ connect: (n: unknown) => n, gain: { setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} } })

describe('playEmergencyChime', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('创建 AudioContext 后显式 resume（防 suspended 态静默）', () => {
    const resume = vi.fn(() => Promise.resolve())
    class MockCtx {
      currentTime = 0
      destination = {}
      resume = resume
      close = () => Promise.resolve()
      createOscillator() { return node() }
      createGain() { return gainNode() }
    }
    vi.stubGlobal('AudioContext', MockCtx)
    playEmergencyChime()
    expect(resume).toHaveBeenCalled() // 关键：显式 resume，否则 suspended 态排了程也不响
  })

  it('无 AudioContext 支持时静默返回（不抛）', () => {
    vi.stubGlobal('AudioContext', undefined)
    vi.stubGlobal('webkitAudioContext', undefined)
    expect(() => playEmergencyChime()).not.toThrow() // 视觉大模态兜底
  })
})
