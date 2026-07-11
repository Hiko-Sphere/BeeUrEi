import { useEffect, useRef, useState } from 'react'
import { api, APIError, fetchRecordingObjectURL, fetchRecordingBlob, type RecordingInfo } from '../lib/api'
import { useI18n } from '../lib/i18n'
import { joinNames } from '../lib/listFormat'
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

  // 下载本人录音（数据可携权）：自助导出刻意不内联媒体、注明"媒体文件另有下载通道"——这里就是那条通道。
  // 扩展名按响应 MIME 推导（iOS 端 quicktime→.mov、web 端→.webm、纯音频→.m4a、其余 mp4 兜底），文件名带录制时刻。
  const [downloadingId, setDownloadingId] = useState<string | null>(null)
  const download = async (rec: RecordingInfo) => {
    if (!rec.hasMedia) { toast(t('该录制暂无可下载媒体', 'No downloadable media'), 'error'); return }
    setDownloadingId(rec.id)
    try {
      const blob = await fetchRecordingBlob(rec.id)
      const ext = blob.type.includes('quicktime') ? 'mov' : blob.type.includes('webm') ? 'webm' : blob.type.startsWith('audio/') ? 'm4a' : 'mp4'
      const d = new Date(rec.recordedAt)
      const pad = (n: number) => String(n).padStart(2, '0')
      const name = `beeurei-recording-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.${ext}`
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = name
      document.body.appendChild(a); a.click(); a.remove()
      // **不同步 revoke**：部分浏览器(Firefox/某些 Safari)在 click 返回后才异步开始读取 blob；且用户若开了"下载前
      // 询问保存位置"，浏览器要等其在"另存为"对话框确认后（可能数秒）才读 blob。同步撤销会让下载读到已失效的
      // URL → 空文件/下载失败（施救者导出取证录音却拿到空文件）。延后释放，给足下载真正开始/对话框确认的时间
      // （对标 FileSaver）；blob 已在内存，仅这次下载短暂多占，到点即释放，不泄漏。不随卸载清除（click 已发出，
      // 卸载后仍需释放这段内存；revoke 无副作用、不触 React）。
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch (e) {
      const msg = e instanceof APIError && e.status === 403 ? t('该录制已删除或无权查看', 'Recording deleted or no access')
        : t('下载失败，请重试', 'Download failed — try again')
      toast(msg, 'error')
    } finally { setDownloadingId(null) }
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
                <div><span className="text-faint">{t('参与者', 'Participants')}：</span>{joinNames(r.participantNames, lang)}</div>
                {/* 录制原因（知情同意透明度）：服务端一直下发 reason 却从未在列表呈现（死字段）。是"为何录这通话"
                    的审计线索——录制功能以双方知情同意为本，把原因如实展示强化透明度。空原因不显示（默认 ''）。 */}
                {r.reason && r.reason.trim() && <div><span className="text-faint">{t('录制原因', 'Reason')}：</span>{r.reason}</div>}
                {r.locationLabel && <div><span className="text-faint">{t('地点', 'Location')}：</span>{r.locationLabel}</div>}
              </div>
              <div className="flex gap-2">
                <Button loading={loadingId === r.id} disabled={!r.hasMedia} onClick={() => play(r)} className="flex-1"><IconFilm width={16} height={16} />{t('播放', 'Play')}</Button>
                {/* 下载（数据可携权的媒体通道）：与播放同鉴权同媒体路径，仅存盘而非播放。 */}
                <Button variant="soft" loading={downloadingId === r.id} disabled={!r.hasMedia} onClick={() => download(r)}
                  aria-label={t('下载录音', 'Download recording')}>{t('下载', 'Download')}</Button>
              </div>
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
