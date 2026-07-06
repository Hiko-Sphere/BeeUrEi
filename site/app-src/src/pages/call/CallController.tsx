import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import { api, callErrorText } from '../../lib/api'
import { useI18n } from '../../lib/i18n'
import { useToast, Avatar, Button, Modal } from '../../components/ui'
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
interface RingState { callId: string; fromName: string; fromAvatar?: string | null; emergency?: boolean }

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
  // 同步"启动中"闩：呼叫/认领/接听在 setActive 之前有 await(守则卡/registerCall/answered)，其间 active 仍为 null。
  // 若只用 active 门控，并发/连点(或无 active 守卫的紧急回拨按钮)会各注册一通、第二个 setActive 覆盖第一个，
  // 首个 callId 被孤立在服务器——盲人求助者可接入那个"没有协助者在场"的房间空等到 TTL 过期(见通话可靠性复审)。
  // ref 读取实时值、不被闭包捕获为旧值，故能挡住 await 窗口内的并发。
  const startingRef = useRef(false)

  useEffect(() => {
    if (ring) { ringtone.current ??= new Ringtone(); ringtone.current.start() }
    else ringtone.current?.stop()
    return () => ringtone.current?.stop()
  }, [ring])

  // —— 协助者行为守则（Aira 范式："只描述所见，安全决策由对方做出"）——
  // 首次协助动作（呼叫/认领/接听）前展示一次性守则卡；确认经 POST /api/assist/guideline-ack 服务端留痕。
  // fail-safe：拉不到 me 时也展示卡（多看一次无害，漏看有害）；确认后本地缓存不再打扰。
  const [guidelinePrompt, setGuidelinePrompt] = useState<null | { resolve: (ok: boolean) => void }>(null)
  const guidelineAcked = useRef<boolean | null>(null) // null=未知（惰性拉 me）
  // 并发协助动作（同时点呼叫+认领）共用同一张守则卡：多个等待者挂进同一队列，确认/关闭时一次性 resolve 全部，
  // 避免第二次 setGuidelinePrompt 覆盖第一个 resolve 使首个动作永远挂起。
  const guidelineWaiters = useRef<((ok: boolean) => void)[]>([])
  const resolveGuideline = (ok: boolean) => {
    const ws = guidelineWaiters.current; guidelineWaiters.current = []
    setGuidelinePrompt(null)
    ws.forEach((w) => w(ok))
  }
  const resolveGuidelineRef = useRef(resolveGuideline)
  resolveGuidelineRef.current = resolveGuideline
  const ensureGuideline = useCallback(async (): Promise<boolean> => {
    if (guidelineAcked.current === true) return true
    if (guidelineAcked.current === null) {
      try { guidelineAcked.current = !!(await api.me()).helperGuidelineAckAt } catch { guidelineAcked.current = false }
      if (guidelineAcked.current) return true
    }
    return new Promise<boolean>((resolve) => {
      guidelineWaiters.current.push(resolve)
      setGuidelinePrompt({ resolve: () => {} }) // 卡已展示；实际 resolve 走 guidelineWaiters
    })
  }, [])
  const confirmGuideline = useCallback(async () => {
    try { await api.guidelineAck() } catch { /* 留痕失败不阻塞协助（下次仍会展示） */ }
    guidelineAcked.current = true
    resolveGuidelineRef.current(true)
  }, [])
  const dismissGuideline = useCallback(() => { resolveGuidelineRef.current(false) }, [])

  const startOutgoing = useCallback(async (targetUserId: string, peerName: string, peerAvatar?: string | null) => {
    if (active || startingRef.current) { toast(t('已有进行中的通话', 'A call is already in progress'), 'error'); return }
    startingRef.current = true // 先上闩再 await：挡住守则卡/网络往返窗口内的并发第二通
    try {
      if (!(await ensureGuideline())) return
      const callId = crypto.randomUUID()
      await api.registerCall(callId, [targetUserId])
      setActive({ callId, kind: 'outgoing', peerUserId: targetUserId, peerName, peerAvatar, waitingText: t('正在呼叫…', 'Calling…') })
    } catch (e) {
      toast(callErrorText(e, t, t('呼叫失败', 'Call failed')), 'error')
    } finally {
      startingRef.current = false
    }
  }, [active, t, toast, ensureGuideline])

  const claimQueue = useCallback(async (callId: string, fromName: string, fromAvatar?: string | null) => {
    if (active || startingRef.current) { toast(t('已有进行中的通话', 'A call is already in progress'), 'error'); return false }
    startingRef.current = true
    try {
      if (!(await ensureGuideline())) return false
      await api.claimHelp(callId)
      setActive({ callId, kind: 'queue', peerName: fromName, peerAvatar: fromAvatar, waitingText: t('正在接入求助者…', 'Connecting to requester…') })
      return true
    } catch (e) {
      toast(callErrorText(e, t, t('认领失败', 'Claim failed')), 'error')
      return false
    } finally {
      startingRef.current = false
    }
  }, [active, t, toast, ensureGuideline])

  // 直接接听一通指定来电（来电列表/来电铃共用）：抢占接听，胜出则进入通话。
  // 接听路径**刻意不设**守则卡阻断：来电可能是紧急求助，接听延迟的安全代价高于教育收益——
  // 守则教育由（非紧急的）呼出/认领闸门 + 通话内常驻提示条完成。
  const answerIncoming = useCallback(async (callId: string, fromName: string, fromAvatar?: string | null) => {
    if (active || startingRef.current) { toast(t('已有进行中的通话', 'A call is already in progress'), 'error'); return }
    startingRef.current = true // 先上闩再 await：挡住连点接听/接听与其它协助动作并发
    setRing(null)
    try {
      const res = await api.answeredCall(callId)
      if (res.youWon) setActive({ callId, kind: 'incoming', peerName: fromName, peerAvatar: fromAvatar, waitingText: t('正在接通…', 'Connecting…') })
      // gone=呼叫已过期/取消（无人接，只是没了）——区别于"别人先接"，措辞如实，避免误报"已被其他亲友接听"。
      else if (res.gone) toast(t('这通来电已结束', 'This call has ended'))
      else toast(t('已被其他亲友接听', 'Answered by someone else'))
    } catch { toast(t('接听失败', 'Failed to answer'), 'error') } finally {
      startingRef.current = false
    }
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
        <IncomingRing fromName={ring.fromName} fromAvatar={ring.fromAvatar} emergency={ring.emergency} onAnswer={answerRing} onDecline={declineRing} />
      )}
      {active && <CallScreen call={active} onEnd={endActive} />}
      {/* 一次性协助守则卡（Aira 范式）：确认前不进入任何协助通话；关闭=放弃本次动作，下次仍会展示。 */}
      {guidelinePrompt && (
        <Modal onClose={dismissGuideline} label={t('协助守则', 'Helper guidelines')}>
          <h3 className="text-lg font-semibold">{t('开始协助前，请了解三条守则', 'Before you help — three ground rules')}</h3>
          <ul className="mt-3 space-y-2.5 text-sm text-soft">
            <li className="flex gap-2"><span aria-hidden="true">👁️</span>
              {t('只描述你所见（如"前方三米有台阶"），不要替对方做安全决策——可以说"灯是绿的"，不要说"可以走了"。',
                 'Describe what you see ("steps three meters ahead"). Never make safety decisions for them — say "the light is green", not "you can go".')}</li>
            <li className="flex gap-2"><span aria-hidden="true">🚸</span>
              {t('过马路等高风险时刻，不确定就直说"我不确定"，行动由对方自己决定。',
                 "At risky moments like crossings, say \"I'm not sure\" when unsure — they decide whether to move.")}</li>
            <li className="flex gap-2"><span aria-hidden="true">🔒</span>
              {t('尊重隐私：画面与对话仅用于本次协助，不截屏、不外传。',
                 'Respect privacy: what you see and hear is for this session only — no screenshots, no sharing.')}</li>
          </ul>
          <Button variant="primary" className="mt-5 w-full" onClick={() => void confirmGuideline()}>
            {t('我已了解，开始协助', 'Got it — start helping')}
          </Button>
          <button onClick={dismissGuideline} className="mt-3 w-full text-center text-sm text-faint hover:underline">
            {t('暂不', 'Not now')}
          </button>
        </Modal>
      )}
    </Ctx.Provider>
  )
}

// 简易来电铃：WebAudio 周期柔和双音，无需音频资源；可停止。
export class Ringtone {
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
      // 无用户手势时 AudioContext 生于 suspended 态、静默不响——每次响铃都尝试 resume：既覆盖初次，也让
      // 响铃期间发生的任何手势在下一拍立即让铃声响起（施救者可能没盯屏，务必让来电铃真能被听到）。
      // 与 playEmergencyChime 的 resume 同因；已运行则为 no-op。
      void this.ctx.resume().catch(() => {})
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

/// 来电铃（无障碍时敏交互）：role=alertdialog + aria-modal + 焦点移入接听键 + 焦点陷阱 + 焦点恢复，
/// 让读屏/键盘用户被明确告知有来电且能到达按钮。**刻意不设 Escape/背景=拒绝**——来电可能是紧急
/// 求助（见 answerIncoming 注释），误触拒掉代价高，必须显式选择接听或拒绝（同真手机的来电界面）。
function IncomingRing({ fromName, fromAvatar, emergency, onAnswer, onDecline }: {
  fromName: string; fromAvatar?: string | null; emergency?: boolean; onAnswer: () => void; onDecline: () => void
}) {
  const { t } = useI18n()
  const answerRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    answerRef.current?.focus() // 焦点落在"接听"：读屏据 aria-label 播报来电对话框 + 当前可接听
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return // Escape 不处理：来电须显式选择，防误拒
      const panel = panelRef.current
      if (!panel) return
      const f = panel.querySelectorAll<HTMLElement>('button:not([disabled])')
      if (f.length === 0) return
      const first = f[0], last = f[f.length - 1], active = document.activeElement
      if (e.shiftKey && active === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey); prev?.focus?.() }
  }, [])
  return (
    <div className="fixed inset-0 z-[120] grid place-items-center bg-black/50 p-4 backdrop-blur-sm">
      <div ref={panelRef} role="alertdialog" aria-modal="true"
        // 紧急求助 → aria-label 点明"紧急"（读屏即刻告知施救者优先级）+ 面板红边突出。
        aria-label={emergency
          ? t(`紧急求助来电：${fromName}，请尽快接听`, `EMERGENCY call from ${fromName} — please answer now`)
          : t(`${fromName} 邀请你协助，来电`, `Incoming assist call from ${fromName}`)}
        className={`slide-up w-full max-w-xs rounded-3xl surface p-6 text-center shadow-2xl outline-none ${emergency ? 'border-2 border-danger' : 'border border-[var(--line)]'}`}>
        <div className="mx-auto mb-4 w-fit"><Avatar name={fromName} src={fromAvatar} size={88} /></div>
        <div className="text-lg font-semibold">{fromName}</div>
        {emergency
          ? <div className="mt-1 text-sm font-semibold text-danger">{t('🆘 紧急求助 · 请尽快接听', '🆘 Emergency · please answer now')}</div>
          : <div className="mt-1 text-sm text-faint">{t('邀请你协助 · 来电', 'Incoming assist call')}</div>}
        <div className="mt-7 flex items-center justify-center gap-8">
          <button onClick={onDecline} className="flex h-16 w-16 items-center justify-center rounded-full bg-danger text-white shadow-lg transition hover:brightness-110" aria-label={t('拒绝', 'Decline')}><IconX width={28} height={28} /></button>
          <button ref={answerRef} onClick={onAnswer} className="flex h-16 w-16 items-center justify-center rounded-full bg-ok text-white shadow-lg ring-live transition hover:brightness-110" aria-label={t('接听', 'Answer')}><IconPhone width={28} height={28} /></button>
        </div>
      </div>
    </div>
  )
}

