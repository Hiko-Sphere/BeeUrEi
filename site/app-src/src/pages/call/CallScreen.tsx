import { useEffect, useRef, useState, type ReactNode } from 'react'
import { api, tokenStore } from '../../lib/api'
import { useI18n } from '../../lib/i18n'
import { useToast, Avatar, Button, Modal } from '../../components/ui'
import { IconMic, IconMicOff, IconFlash, IconZoom, IconRecord, IconHangup, IconFlag, IconUser, IconShield, IconChat, IconSend } from '../../components/icons'
import { CallEngine, type MediaState, type Quality, CALL_TEXT_MAX, validCallText, callTextRejectText, CallQualityAnnouncer } from '../../lib/webrtc'
import type { ActiveCall } from './CallController'

export function CallScreen({ call, onEnd }: { call: ActiveCall; onEnd: (reason?: 'peer' | 'admin' | 'signaling') => void }) {
  const { t } = useI18n()
  const toast = useToast()
  const videoRef = useRef<HTMLVideoElement>(null)
  const engineRef = useRef<CallEngine | null>(null)

  const [statusKey, setStatusKey] = useState<string>('connecting')
  const [connected, setConnected] = useState(false)
  const [peer, setPeer] = useState<{ userId?: string; name?: string; avatar?: string | null }>({ name: call.peerName, avatar: call.peerAvatar, userId: call.peerUserId })
  const [mediaState, setMediaState] = useState<MediaState>('connecting')
  const [peerVideoOn, setPeerVideoOn] = useState(false)
  const [quality, setQuality] = useState<Quality>('unknown')
  const [admin, setAdmin] = useState<{ observing: boolean; name?: string | null }>({ observing: false })
  const [peerRecording, setPeerRecording] = useState(false)
  const [recording, setRecording] = useState(false)
  const [incomingRecReq, setIncomingRecReq] = useState(false)
  const [lastRecId, setLastRecId] = useState<string | null>(null)
  const [micMuted, setMicMuted] = useState(false)
  const [micDenied, setMicDenied] = useState(false)
  const [torchOn, setTorchOn] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [reportOpen, setReportOpen] = useState(false)
  const [elapsed, setElapsed] = useState(0)

  // 通话内实时文字（RTT）：嘈杂环境/听障场景下随音视频并行的文字通道（服务端 in-call-text）。
  const [chatOpen, setChatOpen] = useState(false)
  const chatOpenRef = useRef(false) // engine 回调闭包里读最新开合态
  const [rtt, setRtt] = useState<Array<{ id: string; text: string; mine: boolean; fromAdmin?: boolean; failed?: string }>>([])
  const [unread, setUnread] = useState(0)
  const [draft, setDraft] = useState('')
  // 面板关着时的读屏播报：aria-live 区必须**常驻**（随 chatOpen 卸载的 live region 读屏收不到）。
  const [srNote, setSrNote] = useState('')
  // 信号变差/恢复的读屏主动播报（与 iOS CallQualityAnnouncer 同款去抖：只播进入弱/从弱恢复，连续确认后才播）——
  // web 盲人用户此前只有 QualityBars 的静态 aria-label，信号掉了不会被主动告知。用**独立** live 区，不与文字消息互相冲刷。
  const [qualityNote, setQualityNote] = useState('')
  const qualityAnnouncerRef = useRef(new CallQualityAnnouncer())
  // Safari 的 compositionend 在确认候选词的 keydown 之后才触发，e.nativeEvent.isComposing 在该次
  // keydown 上已是 false——须自持合成态并用 setTimeout(0) 延迟复位才能挡住"确认候选词即误发送"。
  const composingRef = useRef(false)
  const rttLogRef = useRef<HTMLDivElement>(null)
  useEffect(() => { rttLogRef.current?.scrollTo({ top: rttLogRef.current.scrollHeight }) }, [rtt, chatOpen])

  // 通话计时（连接后）。
  useEffect(() => {
    if (!connected) return
    const id = setInterval(() => setElapsed((e) => e + 1), 1000)
    return () => clearInterval(id)
  }, [connected])

  useEffect(() => {
    let cancelled = false
    const token = tokenStore.token
    if (!token) { onEnd(); return }
    ;(async () => {
      let ice: RTCIceServer[] = []
      try { const r = await api.iceServers(); ice = (r.iceServers || []) as RTCIceServer[] } catch { /* 用默认 STUN */ }
      let policy = { enabled: false, requireConsent: true }
      try { const c = await api.appConfig(); policy = c.recording } catch { /* fail-safe 关闭 */ }
      if (cancelled) return
      const engine = new CallEngine({
        callId: call.callId, token, iceServers: ice, recordPolicy: policy,
        cb: {
          onStatus: (k) => setStatusKey(k),
          onConnected: (c) => setConnected(c),
          onPeer: (p) => setPeer((cur) => ({ userId: p.userId ?? cur.userId, name: p.name ?? cur.name, avatar: p.avatar ?? cur.avatar })),
          onMediaState: (s) => setMediaState(s),
          onRemoteStream: (stream) => { if (videoRef.current) videoRef.current.srcObject = stream },
          onPeerVideoGate: (on) => setPeerVideoOn(on),
          onQuality: (q) => {
            setQuality(q)
            const say = qualityAnnouncerRef.current.update(q)
            if (say === 'weak') setQualityNote(t('通话信号弱，可能卡顿或听不清；换个位置或靠近路由器可能会好一些。', 'Call signal is weak — audio may stutter; moving or getting closer to your router may help.'))
            else if (say === 'recovered') setQualityNote(t('通话信号恢复了。', 'Call signal is back to normal.'))
          },
          onAdminObserving: (info) => setAdmin(info),
          onPeerRecording: (on) => setPeerRecording(on),
          onRecordRequest: () => setIncomingRecReq(true),
          onRecordConsentResult: (ok) => toast(ok ? t('对方已同意录制', 'Recording consent granted') : t('对方拒绝了录制', 'Recording declined'), ok ? 'ok' : 'info'),
          onRecordingStateChange: (r) => setRecording(r),
          onRecordingError: (reason) => {
            setRecording(false)
            const msg = reason === 'consent_required' ? t('对方未同意录制', 'Recording was not consented')
              : reason === 'unsupported_media_type' ? t('当前浏览器录制格式不受支持', 'This browser’s recording format is not supported')
              : reason === 'media_too_large' ? t('录制文件过大，未能保存', 'Recording too large to save')
              : reason === 'empty' ? t('未录到内容', 'Nothing was recorded')
              : t('录制保存失败，请重试', 'Failed to save recording, please retry')
            toast(msg, 'error')
          },
          onLastRecordingId: (id) => setLastRecId(id),
          onMicDenied: () => { setMicDenied(true); toast(t('未获得麦克风权限，对方将听不到你', 'Mic blocked — they cannot hear you'), 'error') },
          onCallText: (m) => {
            setRtt((l) => [...l, { id: crypto.randomUUID(), text: m.text, mine: false, fromAdmin: m.fromAdmin }])
            if (!chatOpenRef.current) {
              setUnread((u) => {
                const n = u + 1
                // 计数进播报文案：同文本重复到达时 live region 才会因内容变化重新播报。
                setSrNote(t(`新文字消息（${n}）：${m.text}`, `New text message (${n}): ${m.text}`))
                return n
              })
            }
          },
          onCallTextRejected: (reason, id) => {
            if (id) setRtt((l) => l.map((m) => (m.id === id ? { ...m, failed: reason } : m)))
            toast(callTextRejectText(reason, t), 'error')
          },
          onEnded: (reason) => { engine.hangUp(); onEnd(reason) },
        },
      })
      engineRef.current = engine
      await engine.start()
    })()
    return () => { cancelled = true; engineRef.current?.hangUp(); engineRef.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [call.callId])

  const hangUp = () => { engineRef.current?.hangUp(); onEnd() }
  const toggleMute = () => { const e = engineRef.current; if (!e) return; const next = !micMuted; e.setMicMuted(next); setMicMuted(next) }
  const toggleTorch = () => { const v = engineRef.current?.toggleRemoteTorch(); if (v !== undefined) setTorchOn(v) }
  const cycleZoom = () => { const v = engineRef.current?.cycleRemoteZoom(); if (v !== undefined) setZoom(v) }
  const toggleRecord = () => {
    const e = engineRef.current; if (!e) return
    if (recording) e.stopRecording()
    else if (e.canRecord) e.requestRecording()
    else toast(t('当前无法录制', 'Recording unavailable now'))
  }
  const respondConsent = (ok: boolean) => { engineRef.current?.respondToRecordRequest(ok); setIncomingRecReq(false) }
  const toggleChat = () => {
    const next = !chatOpen
    setChatOpen(next); chatOpenRef.current = next
    if (next) { setUnread(0); setSrNote('') }
  }
  const sendRtt = () => {
    const e = engineRef.current
    const clean = validCallText(draft)
    if (!e || !clean) return
    const id = crypto.randomUUID()
    if (!e.sendCallText(clean, id)) {
      // WS 未连接：不落假气泡、保留草稿，明确告知（绝不静默丢弃）。
      toast(t('尚未连接，文字未发送', 'Not connected — text not sent'), 'error')
      return
    }
    setRtt((l) => [...l, { id, text: clean, mine: true }])
    setDraft('')
  }

  const statusText = ((): string => {
    switch (statusKey) {
      case 'connected': return peer.name ? t(`与 ${peer.name} 通话中`, `In call with ${peer.name}`) : t('通话中', 'Connected')
      case 'peerVideoOn': return t('对方已开启画面', 'Sharing their camera')
      case 'signalingClosed': return t('连接已断开', 'Connection lost')
      case 'mediaFailed': return t('媒体连接失败', 'Media connection failed')
      case 'reconnecting': return t('正在重连…', 'Reconnecting…')
      default: return connected ? t('通话中', 'Connected') : call.waitingText
    }
  })()

  const videoHint = ((): string => {
    if (mediaState === 'failed') return t('媒体连接失败，可能需要稍后重试', 'Media failed — try again later')
    if (mediaState === 'disconnected') return t('正在重连…', 'Reconnecting…')
    if (!connected) return call.waitingText
    return peerVideoOn ? t('正在显示对方画面', 'Showing their camera') : t('对方尚未开启画面', 'They have not shared their camera')
  })()

  return (
    <div className="fixed inset-0 z-[110] flex flex-col bg-[#0b0d14] text-white">
      {/* 常驻读屏播报区：面板关闭时的来信通知。随 chatOpen 卸载的 live region 读屏收不到，必须恒渲染。 */}
      <div className="sr-only" role="status" aria-live="polite">{srNote}</div>
      {/* 信号变差/恢复的主动播报（独立 live 区，不与来信互相冲刷）——盲人 web 用户与 iOS 语音提示对齐。 */}
      <div className="sr-only" role="status" aria-live="polite">{qualityNote}</div>
      {/* 顶部信息 */}
      <div className="flex items-center gap-3 px-4 pt-[max(env(safe-area-inset-top),0.75rem)] pb-3">
        <Avatar name={peer.name || '?'} src={peer.avatar} size={40} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{peer.name || t('未知联系人', 'Unknown')}</div>
          <div className="truncate text-xs text-white/60">{statusText}{connected && ` · ${fmtClock(elapsed)}`}</div>
        </div>
        <QualityBars quality={quality} />
      </div>

      {/* 合规告知横幅（role=alert：被监看/被录制中途出现时读屏**主动播报**——盲人有权即时知道自己正被录制/监看，
          此前是纯视觉 div，读屏用户不导航过去就无从得知，隐私/知情同意攸关）。 */}
      {admin.observing && (
        <ComplianceBanner tone="honey">
          <IconShield width={18} height={18} />
          <span>{t('管理员正在监看本次通话', 'An administrator is observing this call')}{admin.name ? ` · ${admin.name}` : ''}</span>
        </ComplianceBanner>
      )}
      {peerRecording && (
        <ComplianceBanner tone="danger">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-danger ring-live" />
          {t('对方正在录制本次通话', 'The other party is recording this call')}
        </ComplianceBanner>
      )}
      {/* 协助守则提示（对方开画面=正在实地协助）：只描述、不替对方做安全决策（Aira 范式，常驻轻提示）。 */}
      {peerVideoOn && (
        <div className="mx-4 mb-2 rounded-xl bg-white/5 px-3 py-1.5 text-xs text-white/60">
          {t('只描述所见；过街等安全决策请交给对方', 'Describe what you see — safety decisions are theirs to make')}
        </div>
      )}
      {/* 麦克风被阻止：常驻警告（一次性 toast 会消失，协助者会以为对方能听到却一直白说）。 */}
      {micDenied && (
        <div className="mx-4 mb-2 flex items-center gap-2 rounded-xl bg-danger/20 px-3 py-2 text-sm" role="alert">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-danger" />
          {t('麦克风被阻止，对方听不到你——请在浏览器地址栏允许麦克风后重进通话', 'Mic is blocked — they cannot hear you. Allow mic access in the browser, then rejoin.')}
        </div>
      )}

      {/* 远端视频 / 占位 */}
      <div className="relative mx-4 flex-1 overflow-hidden rounded-2xl bg-black">
        <video ref={videoRef} autoPlay playsInline className={`h-full w-full object-contain ${peerVideoOn ? '' : 'opacity-0'}`} />
        {!peerVideoOn && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-6 text-center">
            <Avatar name={peer.name || '?'} src={peer.avatar} size={96} />
            <div className="text-white/70">{videoHint}</div>
            {!connected && <div className="h-5 w-5 animate-spin rounded-full border-2 border-white/40 border-t-transparent" />}
          </div>
        )}
        {recording && (
          <div className="absolute left-3 top-3 flex items-center gap-1.5 rounded-full bg-black/60 px-2.5 py-1 text-xs">
            <span className="inline-block h-2 w-2 rounded-full bg-danger ring-live" />REC
          </div>
        )}
      </div>

      {/* 通话内实时文字（RTT）面板：随音视频并行的文字通道，收发都在通话覆盖层内完成 */}
      {chatOpen && (
        <div className="mx-4 mt-2 flex max-h-52 flex-col rounded-2xl bg-white/5 p-2">
          <div ref={rttLogRef} role="log" aria-live="polite" aria-label={t('通话文字消息', 'In-call text messages')}
            tabIndex={0} /* 可键盘聚焦以滚动日志（WCAG 2.1.1）——纯文字气泡无可聚焦子元素 */
            className="min-h-[3.5rem] flex-1 space-y-1 overflow-y-auto px-1 py-1 text-sm">
            {rtt.length === 0 && (
              <div className="py-2 text-center text-xs text-white/40">{t('文字会实时送达对方并可被读出，适合嘈杂环境', 'Text reaches them instantly and can be read aloud — great for noisy places')}</div>
            )}
            {rtt.map((m) => (
              <div key={m.id} className={`flex ${m.mine ? 'justify-end' : 'justify-start'}`}>
                <span className={`max-w-[80%] break-words rounded-xl px-2.5 py-1.5 ${m.mine ? (m.failed ? 'bg-danger/40 text-white/70 line-through' : 'bg-honey/30') : m.fromAdmin ? 'bg-danger/25' : 'bg-white/15'}`}>
                  {m.fromAdmin && <span className="mr-1.5 text-[10px] font-bold text-danger">{t('管理员', 'Admin')}</span>}
                  {m.text}
                </span>
              </div>
            ))}
          </div>
          <div className="mt-1 flex items-center gap-2">
            <input value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={CALL_TEXT_MAX}
              onCompositionStart={() => { composingRef.current = true }}
              onCompositionEnd={() => { setTimeout(() => { composingRef.current = false }, 0) }}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.nativeEvent.isComposing && !composingRef.current) { e.preventDefault(); sendRtt() } }}
              placeholder={t('输入文字…', 'Type a message…')} aria-label={t('通话文字输入', 'In-call text input')}
              className="min-w-0 flex-1 rounded-xl bg-white/10 px-3 py-2 text-sm outline-none placeholder:text-white/40 focus:bg-white/15" />
            <button onClick={sendRtt} disabled={!validCallText(draft)} aria-label={t('发送文字', 'Send text')}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-honey/40 transition hover:bg-honey/60 disabled:opacity-30">
              <IconSend width={18} height={18} />
            </button>
          </div>
        </div>
      )}

      {/* 控制条 */}
      <div className="px-4 pb-[max(env(safe-area-inset-bottom),1rem)] pt-4">
        <div className="mb-3 flex items-center justify-center gap-2 overflow-x-auto">
          <CtrlButton active={micMuted} danger={micMuted} onClick={toggleMute} icon={micMuted ? <IconMicOff /> : <IconMic />} label={micMuted ? t('已静音', 'Muted') : t('静音', 'Mute')} />
          <CtrlButton active={chatOpen} onClick={toggleChat} icon={<IconChat />} label={unread > 0 ? t(`文字 ${unread}`, `Text ${unread}`) : t('文字', 'Text')} />
          <CtrlButton active={torchOn} onClick={toggleTorch} icon={<IconFlash />} label={t('手电', 'Torch')} disabled={!peerVideoOn} />
          <CtrlButton active={zoom > 1} onClick={cycleZoom} icon={<IconZoom />} label={zoom > 1 ? `${zoom}×` : t('变焦', 'Zoom')} disabled={!peerVideoOn} />
          <CtrlButton active={recording} danger={recording} onClick={toggleRecord} icon={<IconRecord />} label={recording ? t('停止', 'Stop') : t('录制', 'Record')} />
          <CtrlButton onClick={() => setReportOpen(true)} icon={<IconFlag />} label={t('举报', 'Report')} disabled={!peer.userId} />
        </div>
        <div className="flex justify-center">
          <button onClick={hangUp} className="flex h-16 w-16 items-center justify-center rounded-full bg-danger shadow-lg transition hover:brightness-110" aria-label={t('挂断', 'Hang up')}>
            <IconHangup width={30} height={30} />
          </button>
        </div>
      </div>

      {/* 录制知情同意（对端请求录制本端） */}
      {incomingRecReq && (
        <Modal onClose={() => respondConsent(false)} label={t('录制请求', 'Recording request')} dismissible={false} role="alertdialog" panelClassName="w-full max-w-sm">
          <h3 className="text-lg font-semibold">{t('对方请求录制本次通话', 'Recording request')}</h3>
          <p className="mt-2 text-sm text-soft">{t('对方希望录制包含你音视频的本次通话。是否同意？录制将作为合规留存并可用于举报取证。', 'They want to record this call including your audio/video. Allow? Recordings are retained for compliance and may be used as report evidence.')}</p>
          <div className="mt-5 flex gap-3">
            <Button variant="soft" className="flex-1" onClick={() => respondConsent(false)}>{t('拒绝', 'Decline')}</Button>
            <Button variant="primary" className="flex-1" onClick={() => respondConsent(true)}>{t('同意录制', 'Allow')}</Button>
          </div>
        </Modal>
      )}

      {reportOpen && peer.userId && (
        <ReportDialog targetUserId={peer.userId} callId={call.callId} evidenceRecordingId={lastRecId} onClose={() => setReportOpen(false)}
          onAddFriend={async () => {
            try { await api.addLink({ userId: peer.userId }, t('协助者', 'Helper'), false); toast(t('已发送好友请求', 'Friend request sent'), 'ok') }
            catch { toast(t('发送失败', 'Failed'), 'error') }
          }}
          onBlock={async () => {
            try { await api.block(peer.userId!); toast(t('已拉黑对方', 'Blocked'), 'ok') } catch { toast(t('操作失败', 'Failed'), 'error') }
          }} />
      )}
    </div>
  )
}

function CtrlButton({ icon, label, onClick, active, danger, disabled }: { icon: React.ReactNode; label: string; onClick: () => void; active?: boolean; danger?: boolean; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className={`flex min-w-[64px] flex-col items-center gap-1 rounded-2xl px-3 py-2.5 text-[11px] transition disabled:opacity-30 ${danger ? 'bg-danger/30 text-white' : active ? 'bg-honey/30 text-white' : 'bg-white/10 text-white/80 hover:bg-white/15'}`}>
      {icon}{label}
    </button>
  )
}

/// 合规告知横幅（被管理员监看 / 被对方录制）。**role="alert"**：条件挂载（状态转真）时读屏**主动**朗读——
/// 隐私/知情同意攸关，盲人须即时知道自己正被录制/监看，而非等导航到该横幅才发现。tone 决定底色。
export function ComplianceBanner({ tone, children }: { tone: 'honey' | 'danger'; children: ReactNode }) {
  return (
    <div role="alert" className={`mx-4 mb-2 flex items-center gap-2 rounded-xl px-3 py-2 text-sm ${tone === 'danger' ? 'bg-danger/20' : 'bg-honey/20'}`}>
      {children}
    </div>
  )
}

function QualityBars({ quality }: { quality: Quality }) {
  const { t } = useI18n()
  const bars = quality === 'good' ? 3 : quality === 'fair' ? 2 : quality === 'weak' ? 1 : 0
  // 读屏播报本地化的连接质量（此前 aria-label 硬编码英文 "signal N/3"，对中文盲人用户不可读）；
  // role=img 让这组装饰性条形被当作有含义的图形整体朗读，而非三个空 span。
  const desc = quality === 'good' ? t('信号良好', 'Signal good')
    : quality === 'fair' ? t('信号一般', 'Signal fair')
      : quality === 'weak' ? t('信号弱', 'Signal weak')
        : t('信号未知', 'Signal unknown')
  return (
    <div className="flex items-end gap-0.5" role="img" aria-label={desc}>
      {[1, 2, 3].map((i) => <span key={i} className={`w-1 rounded-sm ${i <= bars ? 'bg-ok' : 'bg-white/25'}`} style={{ height: 4 + i * 4 }} />)}
    </div>
  )
}

export function ReportDialog({ targetUserId, callId, evidenceRecordingId, onClose, onAddFriend, onBlock }: {
  targetUserId: string; callId: string; evidenceRecordingId: string | null; onClose: () => void; onAddFriend: () => void; onBlock: () => void
}) {
  const { t } = useI18n()
  const toast = useToast()
  const [reason, setReason] = useState('')
  const [attach, setAttach] = useState(false)
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    if (!reason.trim()) return
    setBusy(true)
    try {
      await api.report(targetUserId, reason.trim(), callId, attach && evidenceRecordingId ? evidenceRecordingId : undefined)
      toast(t('举报已提交', 'Report submitted'), 'ok')
      onClose()
    } catch { toast(t('提交失败', 'Failed to submit'), 'error') } finally { setBusy(false) }
  }
  return (
    <Modal onClose={onClose} label={t('举报与安全', 'Report & Safety')} panelClassName="w-full max-w-sm">
      <h3 className="text-lg font-semibold">{t('举报与安全', 'Report & Safety')}</h3>
      <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={1000}
        placeholder={t('请描述问题（必填）', 'Describe the issue (required)')}
        className="mt-3 w-full resize-none rounded-xl border border-[var(--line)] surface-2 px-3 py-2.5 text-sm outline-none focus:border-honey" />
      {evidenceRecordingId && (
        <label className="mt-3 flex items-center gap-2 text-sm text-soft">
          <input type="checkbox" checked={attach} onChange={(e) => setAttach(e.target.checked)} className="accent-[var(--color-honey)]" />
          {t('附上本次通话录制作为证据', 'Attach this call recording as evidence')}
        </label>
      )}
      <Button variant="danger" className="mt-4 w-full" loading={busy} onClick={submit} disabled={!reason.trim()}>{t('提交举报', 'Submit report')}</Button>
      <div className="mt-3 flex gap-2">
        <Button variant="soft" className="flex-1" onClick={onAddFriend}><IconUser width={16} height={16} />{t('加为联系人', 'Add contact')}</Button>
        <Button variant="ghost" className="flex-1" onClick={onBlock}>{t('拉黑', 'Block')}</Button>
      </div>
      <button onClick={onClose} className="mt-3 w-full text-center text-sm text-faint hover:underline">{t('取消', 'Cancel')}</button>
    </Modal>
  )
}

function fmtClock(sec: number): string { const m = Math.floor(sec / 60), s = sec % 60; return `${m}:${String(s).padStart(2, '0')}` }
