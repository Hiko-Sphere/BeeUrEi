// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { VoiceRecorderButton, VOICE_MAX_SEC } from './VoiceRecorder'

const t = (zh: string, _en: string) => zh

/// 假 MediaRecorder（jsdom 无原生实现）——**对齐真实浏览器语义**（宽松的假会漏掉真崩溃）：
/// ① stop() 在非 recording 态**抛 InvalidStateError**（真实规范行为，快速双击"发送/取消"就会触发）；
/// ② state 同步变 inactive，但 dataavailable/stop 事件**异步**派发（真实浏览器如此——组件在 onstop 前
///    仍持有已停实例，任何未守卫的二次 stop() 都会命中 ①）。
class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = []
  static isTypeSupported: (m: string) => boolean = (m) => m === 'audio/mp4' // 显式注解防 TS 推断成类型谓词（重赋 ()=>false 会报错）
  stream: MediaStream
  ondataavailable: ((e: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  state = 'inactive'
  constructor(stream: MediaStream) { this.stream = stream; FakeMediaRecorder.instances.push(this) }
  start() { this.state = 'recording' }
  stop() {
    if (this.state !== 'recording') throw new DOMException('The MediaRecorder is inactive', 'InvalidStateError')
    this.state = 'inactive'
    queueMicrotask(() => { // 事件异步派发（微任务不受 fake timers 控制，await 即冲刷）
      this.ondataavailable?.({ data: new Blob(['abc'], { type: 'audio/mp4' }) })
      this.onstop?.()
    })
  }
}

const trackStop = vi.fn()
function installStubs() {
  FakeMediaRecorder.instances = []
  trackStop.mockClear()
  vi.stubGlobal('MediaRecorder', FakeMediaRecorder)
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: trackStop }] }) },
  })
}

describe('VoiceRecorderButton 语音消息录制（web 补齐发送侧）', () => {
  beforeEach(installStubs)
  afterEach(() => vi.unstubAllGlobals())

  it('录制→结束并发送：onSend 收到 data:audio/mp4;base64 数据 URL；麦克风被释放', async () => {
    const onSend = vi.fn(), onError = vi.fn()
    render(<VoiceRecorderButton t={t} onSend={onSend} onError={onError} />)
    fireEvent.click(screen.getByTestId('voice-record'))
    await screen.findByTestId('voice-recording')                       // getUserMedia 成功 → 录音中 UI（计时+取消+发送）
    expect(screen.getByRole('status')).toHaveTextContent('0:00')       // 读屏可闻计时
    fireEvent.click(screen.getByLabelText('结束并发送语音'))
    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1))
    expect(onSend.mock.calls[0][0]).toBe('data:audio/mp4;base64,YWJj') // AAC 家族前缀（服务端只收此类，iOS 才播得了）
    expect(trackStop).toHaveBeenCalled()                               // 释放麦克风（红点熄灭）
    expect(screen.getByTestId('voice-record')).toBeInTheDocument()     // 回到待录状态
    expect(onError).not.toHaveBeenCalled()
  })

  it('取消录音：丢弃不发送；麦克风同样释放', async () => {
    const onSend = vi.fn()
    render(<VoiceRecorderButton t={t} onSend={onSend} onError={vi.fn()} />)
    fireEvent.click(screen.getByTestId('voice-record'))
    await screen.findByTestId('voice-recording')
    fireEvent.click(screen.getByLabelText('取消录音'))
    await screen.findByTestId('voice-record') // 回到待录状态
    expect(onSend).not.toHaveBeenCalled()     // 取消=丢弃，绝不误发
    expect(trackStop).toHaveBeenCalled()
  })

  it('浏览器不支持 audio/mp4（如 Firefox）→ 按钮隐藏（能力门控：绝不录对端播不了的格式）', () => {
    FakeMediaRecorder.isTypeSupported = () => false
    try {
      render(<VoiceRecorderButton t={t} onSend={vi.fn()} onError={vi.fn()} />)
      expect(screen.queryByTestId('voice-record')).toBeNull()
    } finally { FakeMediaRecorder.isTypeSupported = (m: string) => m === 'audio/mp4' }
  })

  it('麦克风权限被拒 → onError 提示，不进入录音态', async () => {
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia: vi.fn().mockRejectedValue(new Error('denied')) },
    })
    const onError = vi.fn()
    render(<VoiceRecorderButton t={t} onSend={vi.fn()} onError={onError} />)
    fireEvent.click(screen.getByTestId('voice-record'))
    await waitFor(() => expect(onError).toHaveBeenCalledWith('麦克风权限被拒绝，无法录语音'))
    expect(screen.queryByTestId('voice-recording')).toBeNull()
  })

  it('快速双击"结束并发送"：不崩（真实 stop() 对已停实例抛 InvalidStateError，须幂等守卫）、只发一次', async () => {
    // jsdom 会吞掉事件监听器里抛出的异常、转成 window error 事件——不捕获它，"崩了"的断言就是假的
    // （曾让本测在未守卫实现下照样绿）。故显式收集 window error 断言为空。
    const windowErrors: unknown[] = []
    const onWindowError = (e: ErrorEvent) => { windowErrors.push(e.error ?? e.message); e.preventDefault() }
    window.addEventListener('error', onWindowError)
    try {
      const onSend = vi.fn(), onError = vi.fn()
      render(<VoiceRecorderButton t={t} onSend={onSend} onError={onError} />)
      fireEvent.click(screen.getByTestId('voice-record'))
      await screen.findByTestId('voice-recording')
      const sendBtn = screen.getByLabelText('结束并发送语音')
      fireEvent.click(sendBtn)
      fireEvent.click(sendBtn) // 第二击落在事件异步派发之前（onstop 未跑、recRef 未清、state 已 inactive）——未守卫即抛
      await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1)) // 只发一次
      expect(windowErrors).toEqual([])                             // 且无未捕获异常（守卫幂等）
      expect(onError).not.toHaveBeenCalled()
    } finally { window.removeEventListener('error', onWindowError) }
  })

  it(`录满 ${VOICE_MAX_SEC}s 自动停止并发送（不会无限录爆服务端体积上限）`, async () => {
    vi.useFakeTimers()
    try {
      const onSend = vi.fn()
      render(<VoiceRecorderButton t={t} onSend={onSend} onError={vi.fn()} />)
      fireEvent.click(screen.getByTestId('voice-record'))
      await act(async () => { await Promise.resolve() }) // 让 getUserMedia 的微任务落定（fake timers 下无真实等待）
      expect(screen.getByTestId('voice-recording')).toBeInTheDocument()
      const rec = FakeMediaRecorder.instances[0]
      await act(async () => { await vi.advanceTimersByTimeAsync(VOICE_MAX_SEC * 1000) })
      expect(rec.state).toBe('inactive') // 到上限自动 stop()
    } finally { vi.useRealTimers() }
    // 回到真实时钟后等 FileReader 完成 → 自动发送。
    await waitFor(() => expect(screen.getByTestId('voice-record')).toBeInTheDocument())
  })
})
