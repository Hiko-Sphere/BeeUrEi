import { useEffect, useState } from 'react'
import { api, APIError, type RecordingInfo } from '../lib/api'
import { apiURL } from '../lib/config'
import { useI18n } from '../lib/i18n'
import { Card, Button, Pill, Spinner, EmptyState, useToast, fmtTime, fmtDuration } from '../components/ui'
import { IconFilm, IconX } from '../components/icons'

export function RecordingsPage() {
  const { t, lang } = useI18n()
  const toast = useToast()
  const [items, setItems] = useState<RecordingInfo[] | null>(null)
  const [playing, setPlaying] = useState<{ rec: RecordingInfo; url: string } | null>(null)
  const [loadingId, setLoadingId] = useState<string | null>(null)

  const load = async () => { try { const r = await api.myRecordings(); setItems(r.recordings) } catch { setItems([]) } }
  useEffect(() => { void load() }, [])

  const play = async (rec: RecordingInfo) => {
    if (!rec.hasMedia) { toast(t('该录制暂无可播放媒体', 'No playable media'), 'error'); return }
    setLoadingId(rec.id)
    try {
      const { token } = await api.recordingPlayToken(rec.id)
      setPlaying({ rec, url: apiURL(`/api/recordings/${rec.id}/media?t=${encodeURIComponent(token)}`) })
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
                  <div className="font-semibold">{fmtTime(r.recordedAt, lang)}</div>
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

      {playing && (
        <div className="fixed inset-0 z-[120] grid place-items-center bg-black/80 p-4" onClick={() => setPlaying(null)}>
          <div className="w-full max-w-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between text-white">
              <span className="text-sm">{fmtTime(playing.rec.recordedAt, lang)}</span>
              <button onClick={() => setPlaying(null)} aria-label={t('关闭', 'Close')}><IconX /></button>
            </div>
            <video src={playing.url} controls autoPlay playsInline className="max-h-[70vh] w-full rounded-xl bg-black" />
          </div>
        </div>
      )}
    </div>
  )
}
