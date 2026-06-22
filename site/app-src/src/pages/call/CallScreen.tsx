import { useEffect, useRef, useState } from 'react'
import { api, tokenStore } from '../../lib/api'
import { useI18n } from '../../lib/i18n'
import { useToast, Avatar, Button } from '../../components/ui'
import { IconMic, IconMicOff, IconFlash, IconZoom, IconRecord, IconHangup, IconFlag, IconUser, IconShield } from '../../components/icons'
import { CallEngine, type MediaState, type Quality } from '../../lib/webrtc'
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
  const [torchOn, setTorchOn] = useState(false)
  const [zoom, setZoom] = useState(1)
  const [reportOpen, setReportOpen] = useState(false)
  const [elapsed, setElapsed] = useState(0)

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
          onQuality: (q) => setQuality(q),
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
          onMicDenied: () => toast(t('未获得麦克风权限，对方将听不到你', 'Mic blocked — they cannot hear you'), 'error'),
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
      {/* 顶部信息 */}
      <div className="flex items-center gap-3 px-4 pt-[max(env(safe-area-inset-top),0.75rem)] pb-3">
        <Avatar name={peer.name || '?'} src={peer.avatar} size={40} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{peer.name || t('未知联系人', 'Unknown')}</div>
          <div className="truncate text-xs text-white/60">{statusText}{connected && ` · ${fmtClock(elapsed)}`}</div>
        </div>
        <QualityBars quality={quality} />
      </div>

      {/* 合规告知横幅 */}
      {admin.observing && (
        <div className="mx-4 mb-2 flex items-center gap-2 rounded-xl bg-honey/20 px-3 py-2 text-sm">
          <IconShield width={18} height={18} />
          <span>{t('管理员正在监看本次通话', 'An administrator is observing this call')}{admin.name ? ` · ${admin.name}` : ''}</span>
        </div>
      )}
      {peerRecording && (
        <div className="mx-4 mb-2 flex items-center gap-2 rounded-xl bg-danger/20 px-3 py-2 text-sm">
          <span className="inline-block h-2.5 w-2.5 rounded-full bg-danger ring-live" />
          {t('对方正在录制本次通话', 'The other party is recording this call')}
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

      {/* 控制条 */}
      <div className="px-4 pb-[max(env(safe-area-inset-bottom),1rem)] pt-4">
        <div className="mb-3 flex items-center justify-center gap-2 overflow-x-auto">
          <CtrlButton active={micMuted} danger={micMuted} onClick={toggleMute} icon={micMuted ? <IconMicOff /> : <IconMic />} label={micMuted ? t('已静音', 'Muted') : t('静音', 'Mute')} />
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
        <Modal>
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

function QualityBars({ quality }: { quality: Quality }) {
  const bars = quality === 'good' ? 3 : quality === 'fair' ? 2 : quality === 'weak' ? 1 : 0
  return (
    <div className="flex items-end gap-0.5" aria-label={`signal ${bars}/3`}>
      {[1, 2, 3].map((i) => <span key={i} className={`w-1 rounded-sm ${i <= bars ? 'bg-ok' : 'bg-white/25'}`} style={{ height: 4 + i * 4 }} />)}
    </div>
  )
}

function Modal({ children }: { children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-[130] grid place-items-center bg-black/60 p-4">
      <div className="slide-up w-full max-w-sm rounded-2xl surface border border-[var(--line)] p-6 text-[var(--text)] shadow-2xl">{children}</div>
    </div>
  )
}

function ReportDialog({ targetUserId, callId, evidenceRecordingId, onClose, onAddFriend, onBlock }: {
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
    <Modal>
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
