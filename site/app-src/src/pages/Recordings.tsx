import { useEffect, useRef, useState } from 'react'
import { api, APIError, fetchRecordingObjectURL, type RecordingInfo } from '../lib/api'
import { useI18n } from '../lib/i18n'
import { Card, Button, Pill, Spinner, EmptyState, useToast, fmtTime, fmtDuration, RelativeTime } from '../components/ui'
import { IconFilm, IconX } from '../components/icons'

export function RecordingsPage() {
  const { t, lang } = useI18n()
  const toast = useToast()
  const [items, setItems] = useState<RecordingInfo[] | null>(null)
  const [playing, setPlaying] = useState<{ rec: RecordingInfo; url: string } | null>(null)
  const [loadingId, setLoadingId] = useState<string | null>(null)

  const load = async () => { try { const r = await api.myRecordings(); setItems(r.recordings) } catch { setItems([]) } }
  useEffect(() => { void load() }, [])
  // 回放用的是 blob objectURL：关闭弹窗 / 换播另一条 / 卸载时释放，避免内存泄漏。
  useEffect(() => { const u = playing?.url; return () => { if (u) URL.revokeObjectURL(u) } }, [playing?.url])
  // 卸载守卫：若在 fetchRecordingObjectURL 在途时卸载，setPlaying 是 no-op，新建的 blob URL 永不进 state、
  // 也就永不被上面的 effect 释放 → 泄漏到标签页关闭。故 await 后重检 alive，未挂载则就地 revoke（复审 LOW）。
  const alive = useRef(true)
  useEffect(() => () => { alive.current = false }, [])

  const play = async (rec: RecordingInfo) => {
    if (!rec.hasMedia) { toast(t('该录制暂无可播放媒体', 'No playable media'), 'error'); return }
    setLoadingId(rec.id)
    try {
      const url = await fetchRecordingObjectURL(rec.id) // Bearer→blob：无 60s 令牌过期、拖动/重播不再请求服务端
      if (!alive.current) { URL.revokeObjectURL(url); return } // 卸载于在途：就地释放，不泄漏
      setPlaying({ rec, url })
    } catch (e) {
      const msg = e instanceof APIError && e.status === 403 ? t('该录制已删除或无权查看', 'Recording deleted or no access')
        : e instanceof APIError && e.status === 404 ? t('找不到录制或媒体文件', 'Recording or media not found')
        : t('无法播放，请重试', 'Cannot play, retry')
      toast(msg, 'error')
    } finally { setLoadingId(null) }
  }

  const del = async (rec: RecordingInfo) => {
    if (!confirm(t('确定删除这条录制？删除后你将无法再看到（合规留存期内管理员仍可查看）。', 'Delete this recording? You will no longer see it (admins retain it for compliance).'))) return
    try { await api.deleteMyRecording(rec.id); setItems((cur) => cur?.filter((x) => x.id !== rec.id) ?? cur); toast(t('已删除', 'Deleted'), 'ok') }
    catch { toast(t('删除失败', 'Failed'), 'error') }
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('我的录音', 'My recordings')}</h1>
        <p className="mt-1 text-sm text-faint">{t('经双方知情同意录制的通话。仅你与管理员可在留存期内查看。', 'Calls recorded with mutual consent. Visible to you and admins during retention.')}</p>
      </div>

      {items === null ? <Spinner /> : items.length === 0 ? (
        <Card><EmptyState icon={<IconFilm />} title={t('暂无录音', 'No recordings')} message={t('在通话中开启录制后，记录会显示在这里', 'Recorded calls appear here')} /></Card>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {items.map((r) => (
            <Card key={r.id} className="flex flex-col gap-3 p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <RelativeTime ms={r.recordedAt} lang={lang} className="font-semibold" />
                  <div className="mt-0.5 flex flex-wrap gap-1.5 text-xs">
                    {typeof r.durationSec === 'number' && <Pill>{fmtDuration(r.durationSec)}</Pill>}
                    {r.hasMedia ? <Pill tone="ok">{t('可播放', 'Playable')}</Pill> : <Pill tone="danger">{t('无媒体', 'No media')}</Pill>}
                  </div>
                </div>
                <button onClick={() => del(r)} className="text-faint hover:text-danger" aria-label={t('删除', 'Delete')}><IconX width={18} height={18} /></button>
              </div>
              <div className="text-sm text-soft">
                <div><span className="text-faint">{t('参与者', 'Participants')}：</span>{r.participantNames.join('、') || '—'}</div>
                {r.locationLabel && <div><span className="text-faint">{t('地点', 'Location')}：</span>{r.locationLabel}</div>}
              </div>
              <Button loading={loadingId === r.id} disabled={!r.hasMedia} onClick={() => play(r)} className="w-full"><IconFilm width={16} height={16} />{t('播放', 'Play')}</Button>
            </Card>
          ))}
        </div>
      )}

      {playing && <RecordingPlayer url={playing.url} recordedAt={playing.rec.recordedAt} lang={lang} t={t} onClose={() => setPlaying(null)} />}
    </div>
  )
}

/// 录音回放弹窗（无障碍：role=dialog + aria-modal + Escape 关闭 + 焦点移入/陷阱/恢复，与来电铃同标准）——
/// 此前是裸 div 覆盖层，键盘/读屏用户无法被告知这是弹窗、Esc 关不掉、焦点还留在弹窗背后的"播放"键上。
function RecordingPlayer({ url, recordedAt, lang, t, onClose }: {
  url: string; recordedAt: number; lang: 'zh' | 'en'; t: (z: string, e: string) => string; onClose: () => void
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null
    closeRef.current?.focus() // 焦点移入弹窗（否则留在背后的"播放"键，读屏不知弹窗已开）
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); return } // 视频弹窗可 Esc 关闭（区别于来电铃刻意不给 Esc）
      if (e.key !== 'Tab') return
      const panel = panelRef.current; if (!panel) return
      const f = Array.from(panel.querySelectorAll<HTMLElement>('button:not([disabled]), video'))
      if (f.length === 0) return
      const first = f[0], last = f[f.length - 1], activeEl = document.activeElement
      if (e.shiftKey && activeEl === first) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && activeEl === last) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('keydown', onKey); prev?.focus?.() } // 关闭恢复焦点
  }, [onClose])
  return (
    <div className="fixed inset-0 z-[120] grid place-items-center bg-black/80 p-4" onClick={onClose}>
      <div ref={panelRef} role="dialog" aria-modal="true" aria-label={t('录音回放', 'Recording playback')}
        className="w-full max-w-2xl outline-none" onClick={(e) => e.stopPropagation()}>
        <div className="mb-2 flex items-center justify-between text-white">
          <span className="text-sm">{fmtTime(recordedAt, lang)}</span>
          <button ref={closeRef} onClick={onClose} aria-label={t('关闭', 'Close')}><IconX /></button>
        </div>
        <video src={url} controls autoPlay playsInline className="max-h-[70vh] w-full rounded-xl bg-black" />
      </div>
    </div>
  )
}
