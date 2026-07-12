import { useEffect, useRef, useState } from 'react'
import { IconMic, IconSend, IconX } from './icons'

/// 语音消息录制按钮（Chat composer 用）：盲人收件方听语音远比读文字省力（VoiceOver 用户的首选消息形态），
/// 此前 web 只能**收听** iOS 发来的语音、不能回发——补齐发送侧。
///
/// 格式约束（跨端可播放是硬前提）：服务端只收 AAC 家族 data URL（^data:audio\/(m4a|mp4|aac|x-m4a)），
/// 因为 iOS AVAudioPlayer **播不了** webm/opus——若放宽服务端去收 webm，盲人 iPhone 端将点开无声。
/// 故 web 端只用 MediaRecorder 录 audio/mp4（Safari 14+ / Chrome 126+ 支持）；不支持的浏览器（如 Firefox）
/// **诚实隐藏**按钮（能力门控，同此前行为无回退损失），绝不录一种对端播不了的格式。
///
/// 60s 上限：32kbps AAC 60s ≈ 240KB 原始 ≈ 320KB base64，稳在服务端 550KB data URL 上限内；到点自动发送。
export const VOICE_MAX_SEC = 60
export const VOICE_MIME = 'audio/mp4'

export function voiceRecordingSupported(): boolean {
  return typeof MediaRecorder !== 'undefined'
    && typeof MediaRecorder.isTypeSupported === 'function'
    && MediaRecorder.isTypeSupported(VOICE_MIME)
    && !!navigator.mediaDevices?.getUserMedia
}

export function VoiceRecorderButton({ disabled, onSend, onError, t }: {
  disabled?: boolean // 发送中等外部忙态：与附件按钮同步禁用
  onSend: (dataUrl: string) => void // data:audio/mp4;base64,...（调用方负责 sendMessage(kind='audio')）
  onError: (msg: string) => void    // 权限被拒/设备不可用等，调用方 toast
  t: (zh: string, en: string) => string
}) {
  const [recording, setRecording] = useState(false)
  const [sec, setSec] = useState(0)
  const recRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const discardRef = useRef(false) // 取消：丢弃录音不发送（onstop 里检查）
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const elapsedRef = useRef(0) // 已录秒数（60s 上限判据）：放 ref、在 interval 回调里判——setState 更新器须纯，绝不在其中调 stop()

  /// 安全停止：真实 MediaRecorder 的 stop() 在 inactive 态**抛 InvalidStateError**、且 dataavailable/stop 事件
  /// **异步**派发（recRef 要到 onstop 才清）——快速双击"发送/取消"、或 60s 自动停与手动停竞态时，第二次会对
  /// 已停实例再调 stop() 而崩。故一律经此守卫（state 检查 + try/catch 双保险），任何停止路径都幂等。
  const safeStop = () => {
    const r = recRef.current
    if (r && r.state === 'recording') { try { r.stop() } catch { /* 已停（竞态）：无事可做 */ } }
  }

  const cleanup = () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
    // 释放麦克风（红点熄灭）：不释放会让浏览器持续显示"正在录音"，用户不安。
    recRef.current?.stream.getTracks().forEach((tk) => tk.stop())
    recRef.current = null
    setRecording(false); setSec(0)
  }

  const start = async () => {
    if (recording || disabled) return
    let stream: MediaStream
    try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }) }
    catch { onError(t('麦克风权限被拒绝，无法录语音', 'Microphone permission denied — cannot record')); return }
    let rec: MediaRecorder
    try { rec = new MediaRecorder(stream, { mimeType: VOICE_MIME, audioBitsPerSecond: 32_000 }) }
    catch { stream.getTracks().forEach((tk) => tk.stop()); onError(t('当前浏览器不支持录制语音', 'Voice recording not supported in this browser')); return }
    chunksRef.current = []
    discardRef.current = false
    rec.ondataavailable = (e: BlobEvent) => { if (e.data && e.data.size > 0) chunksRef.current.push(e.data) }
    rec.onstop = () => {
      const discarded = discardRef.current
      const blob = new Blob(chunksRef.current, { type: VOICE_MIME })
      cleanup()
      if (discarded || blob.size === 0) return
      const reader = new FileReader()
      reader.onload = () => {
        const dataUrl = String(reader.result)
        // 极限守卫（60s@32kbps 正常远小于此）：超服务端 550KB 上限如实报错，绝不发出必被 400 的请求。
        if (dataUrl.length > 540_000) { onError(t('语音过长，无法发送', 'Recording too long to send')); return }
        onSend(dataUrl)
      }
      reader.onerror = () => onError(t('语音处理失败，请重试', 'Failed to process recording — try again'))
      reader.readAsDataURL(blob)
    }
    recRef.current = rec
    rec.start()
    setRecording(true); setSec(0); elapsedRef.current = 0
    timerRef.current = setInterval(() => {
      // 上限判据与副作用都在 interval 回调里（elapsedRef），setState 更新器保持纯函数——
      // 若把 stop() 塞进更新器，StrictMode 双调更新器会对已停实例二次 stop() 抛 InvalidStateError。
      elapsedRef.current += 1
      setSec(elapsedRef.current)
      if (elapsedRef.current >= VOICE_MAX_SEC) safeStop() // 到 60s 上限自动停止并发送（onstop 走发送）
    }, 1000)
  }

  const stopAndSend = () => { safeStop() }
  const cancel = () => { discardRef.current = true; safeStop() }

  // 卸载（切会话/离开页面）时丢弃并释放麦克风：绝不后台继续录。
  useEffect(() => () => { discardRef.current = true; safeStop() }, []) // eslint-disable-line react-hooks/exhaustive-deps

  if (!voiceRecordingSupported()) return null // 能力门控：录不出对端可播的格式就不给按钮（诚实，无假功能）

  if (!recording) {
    return (
      <button type="button" onClick={() => void start()} disabled={disabled} data-testid="voice-record"
        aria-label={t('录制语音消息', 'Record a voice message')}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full surface-2 text-soft disabled:opacity-40">
        <IconMic width={18} height={18} />
      </button>
    )
  }
  return (
    <div className="flex shrink-0 items-center gap-1.5" data-testid="voice-recording">
      <button type="button" onClick={cancel} aria-label={t('取消录音', 'Cancel recording')}
        className="flex h-10 w-10 items-center justify-center rounded-full surface-2 text-danger">
        <IconX width={16} height={16} />
      </button>
      {/* 计时（role=status 读屏可闻进度）：接近上限时提示将自动发送。 */}
      <span role="status" className="min-w-[52px] text-center text-xs font-medium tabular-nums text-danger">
        {`0:${String(sec).padStart(2, '0')}`}{sec >= VOICE_MAX_SEC - 10 ? ` / 1:00` : ''}
      </span>
      <button type="button" onClick={stopAndSend} aria-label={t('结束并发送语音', 'Stop and send voice message')}
        className="flex h-10 w-10 items-center justify-center rounded-full bg-honey text-ink">
        <IconSend width={16} height={16} />
      </button>
    </div>
  )
}
