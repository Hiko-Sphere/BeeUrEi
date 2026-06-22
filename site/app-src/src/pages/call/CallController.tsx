import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { api, APIError } from '../../lib/api'
import { useI18n } from '../../lib/i18n'
import { useToast, Avatar, Button } from '../../components/ui'
import { IconPhone, IconX } from '../../components/icons'
import { CallScreen } from './CallScreen'

export interface ActiveCall {
  callId: string
  kind: 'outgoing' | 'incoming' | 'queue'
  peerUserId?: string
  peerName?: string
  peerAvatar?: string | null
  waitingText: string
}
interface RingState { callId: string; fromName: string; fromAvatar?: string | null }

interface CallCtx {
  active: ActiveCall | null
  startOutgoing: (targetUserId: string, peerName: string, peerAvatar?: string | null) => Promise<void>
  claimQueue: (callId: string, fromName: string, fromAvatar?: string | null) => Promise<boolean>
  answerIncoming: (callId: string, fromName: string, fromAvatar?: string | null) => Promise<void>
  presentRing: (r: RingState) => void
  dismissRingIfGone: (activeCallIds: Set<string>) => void
}
const Ctx = createContext<CallCtx>({ active: null, startOutgoing: async () => {}, claimQueue: async () => false, answerIncoming: async () => {}, presentRing: () => {}, dismissRingIfGone: () => {} })
export const useCall = () => useContext(Ctx)

export function CallProvider({ children }: { children: ReactNode }) {
  const { t } = useI18n()
  const toast = useToast()
  const [active, setActive] = useState<ActiveCall | null>(null)
  const [ring, setRing] = useState<RingState | null>(null)
  const ringtone = useRef<Ringtone | null>(null)

  useEffect(() => {
    if (ring) { ringtone.current ??= new Ringtone(); ringtone.current.start() }
    else ringtone.current?.stop()
    return () => ringtone.current?.stop()
  }, [ring])

  const startOutgoing = useCallback(async (targetUserId: string, peerName: string, peerAvatar?: string | null) => {
    if (active) { toast(t('已有进行中的通话', 'A call is already in progress'), 'error'); return }
    const callId = crypto.randomUUID()
    try {
      await api.registerCall(callId, [targetUserId])
      setActive({ callId, kind: 'outgoing', peerUserId: targetUserId, peerName, peerAvatar, waitingText: t('正在呼叫…', 'Calling…') })
    } catch (e) {
      toast(e instanceof APIError && e.code === 'not_linked' ? t('你们尚未建立联系', 'You are not linked') : t('呼叫失败', 'Call failed'), 'error')
    }
  }, [active, t, toast])

  const claimQueue = useCallback(async (callId: string, fromName: string, fromAvatar?: string | null) => {
    if (active) { toast(t('已有进行中的通话', 'A call is already in progress'), 'error'); return false }
    try {
      await api.claimHelp(callId)
      setActive({ callId, kind: 'queue', peerName: fromName, peerAvatar: fromAvatar, waitingText: t('正在接入求助者…', 'Connecting to requester…') })
      return true
    } catch (e) {
      toast(e instanceof APIError && e.code === 'already_claimed_or_gone' ? t('该求助已被认领或已结束', 'Already claimed or gone') : t('认领失败', 'Claim failed'), 'error')
      return false
    }
  }, [active, t, toast])

  // 直接接听一通指定来电（来电列表/来电铃共用）：抢占接听，胜出则进入通话。
  const answerIncoming = useCallback(async (callId: string, fromName: string, fromAvatar?: string | null) => {
    if (active) { toast(t('已有进行中的通话', 'A call is already in progress'), 'error'); return }
    setRing(null)
    try {
      const res = await api.answeredCall(callId)
      if (res.youWon) setActive({ callId, kind: 'incoming', peerName: fromName, peerAvatar: fromAvatar, waitingText: t('正在接通…', 'Connecting…') })
      else toast(t('已被其他亲友接听', 'Answered by someone else'))
    } catch { toast(t('接听失败', 'Failed to answer'), 'error') }
  }, [active, t, toast])

  const presentRing = useCallback((r: RingState) => { setRing((cur) => cur || active ? cur : r) }, [active])

  const dismissRingIfGone = useCallback((ids: Set<string>) => {
    setRing((cur) => (cur && !ids.has(cur.callId) ? null : cur))
  }, [])

  const answerRing = useCallback(async () => {
    if (!ring) return
    await answerIncoming(ring.callId, ring.fromName, ring.fromAvatar)
  }, [ring, answerIncoming])

  const declineRing = useCallback(async () => {
    if (!ring) return
    const r = ring
    setRing(null)
    try { await api.declineCall(r.callId) } catch { /* ignore */ }
  }, [ring])

  const endActive = useCallback((reason?: 'peer' | 'admin' | 'signaling') => {
    setActive((cur) => {
      if (cur) {
        // 主叫/认领方主动结束：清理待接登记，避免对端继续看到来电。
        if (cur.kind !== 'incoming') void api.cancelCall(cur.callId).catch(() => {})
      }
      return null
    })
    if (reason === 'admin') toast(t('通话已被管理员结束', 'Call ended by an administrator'))
    else if (reason === 'peer') toast(t('对方已挂断', 'The other party hung up'))
  }, [t, toast])

  return (
    <Ctx.Provider value={{ active, startOutgoing, claimQueue, answerIncoming, presentRing, dismissRingIfGone }}>
      {children}
      {ring && !active && (
        <div className="fixed inset-0 z-[120] grid place-items-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="slide-up w-full max-w-xs rounded-3xl surface border border-[var(--line)] p-6 text-center shadow-2xl">
            <div className="mx-auto mb-4 w-fit"><Avatar name={ring.fromName} src={ring.fromAvatar} size={88} /></div>
            <div className="text-lg font-semibold">{ring.fromName}</div>
            <div className="mt-1 text-sm text-faint">{t('邀请你协助 · 来电', 'Incoming assist call')}</div>
            <div className="mt-7 flex items-center justify-center gap-8">
              <button onClick={declineRing} className="flex h-16 w-16 items-center justify-center rounded-full bg-danger text-white shadow-lg transition hover:brightness-110" aria-label={t('拒绝', 'Decline')}><IconX width={28} height={28} /></button>
              <button onClick={answerRing} className="flex h-16 w-16 items-center justify-center rounded-full bg-ok text-white shadow-lg ring-live transition hover:brightness-110" aria-label={t('接听', 'Answer')}><IconPhone width={28} height={28} /></button>
            </div>
          </div>
        </div>
      )}
      {active && <CallScreen call={active} onEnd={endActive} />}
    </Ctx.Provider>
  )
}

// 简易来电铃：WebAudio 周期柔和双音，无需音频资源；可停止。
class Ringtone {
  private ctx: AudioContext | null = null
  private timer: ReturnType<typeof setInterval> | null = null
  start() {
    if (this.timer) return
    try {
      const Ctx: typeof AudioContext = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
      this.ctx = new Ctx()
    } catch { return }
    const beep = () => {
      if (!this.ctx) return
      for (const [i, freq] of [880, 1180].entries()) {
        const o = this.ctx.createOscillator(); const g = this.ctx.createGain()
        o.frequency.value = freq; o.type = 'sine'
        const ts = this.ctx.currentTime + i * 0.22
        g.gain.setValueAtTime(0, ts); g.gain.linearRampToValueAtTime(0.12, ts + 0.02); g.gain.linearRampToValueAtTime(0, ts + 0.2)
        o.connect(g); g.connect(this.ctx.destination); o.start(ts); o.stop(ts + 0.22)
      }
    }
    beep(); this.timer = setInterval(beep, 1800)
  }
  stop() {
    if (this.timer) { clearInterval(this.timer); this.timer = null }
    try { void this.ctx?.close() } catch { /* ignore */ }
    this.ctx = null
  }
}

// 来电铃覆盖层导出的便捷按钮（供其它位置触发；当前内部使用）。
export function AnswerButton(props: { onClick: () => void; label: string }) {
  return <Button variant="ok" onClick={props.onClick}><IconPhone width={18} height={18} />{props.label}</Button>
}
