import { useState } from 'react'
import { api, type EmergencyHistoryItem } from '../lib/api'
import { useI18n } from '../lib/i18n'
import { appleMapsUrl } from '../lib/location'
import { emergencyLocInfo } from '../lib/emergencyLoc'
import { Card, Pill, RelativeTime, fmtTime } from './ui'

/// 本人紧急事件历史（Family 页，独立组件，折叠+懒加载）：过往 SOS/摔倒/撞击告警回看——何时、触达几人、
/// 是否有人响应、是否已报平安。医疗警报行业标配的 alert history。空历史给安心文案。
function kindLabel(kind: string, t: (z: string, e: string) => string): string {
  switch (kind) {
    case 'fall': return t('疑似摔倒', 'Suspected fall')
    case 'crash': return t('疑似撞击', 'Suspected crash')
    case 'manual': return t('手动 SOS', 'Manual SOS')
    default: return kind
  }
}
function outcome(it: EmergencyHistoryItem, t: (z: string, e: string) => string): { text: string; tone: 'ok' | 'danger' | 'honey' } {
  if (it.resolved) return { text: t('已报平安', 'Resolved'), tone: 'ok' }
  if (it.acked) return { text: t('有人响应', 'Someone responded'), tone: 'honey' }
  if (it.escalated) return { text: t('升级后仍无人响应', 'Unanswered after escalation'), tone: 'danger' }
  return { text: t('无人响应', 'No response'), tone: 'danger' }
}

export function EmergencyHistorySection() {
  const { t, lang } = useI18n()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<EmergencyHistoryItem[] | null>(null)
  const [loading, setLoading] = useState(false)

  const toggle = async () => {
    const next = !open
    setOpen(next)
    if (next && items === null && !loading) {
      setLoading(true)
      try { setItems((await api.emergencyHistory()).history) }
      catch { setItems([]) }
      finally { setLoading(false) }
    }
  }

  return (
    <Card className="overflow-hidden">
      <button type="button" onClick={() => void toggle()} aria-expanded={open}
        className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-semibold hover:surface-2">
        <span>{t('紧急事件历史', 'Emergency history')}</span>
        <span className="text-xs text-faint">{open ? t('收起', 'Hide') : t('查看', 'View')}</span>
      </button>
      {open && (
        <div className="border-t border-[var(--line)] px-4 py-3">
          {loading ? (
            <div className="text-xs text-faint">{t('加载中…', 'Loading…')}</div>
          ) : items && items.length > 0 ? (
            <ul className="divide-y divide-[var(--line)]">
              {items.map((it) => {
                const o = outcome(it, t)
                return (
                  <li key={it.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                    <Pill tone={it.kind === 'manual' ? 'honey' : 'danger'}>{kindLabel(it.kind, t)}</Pill>
                    <RelativeTime ms={it.at} lang={lang} className="text-faint" />
                    <Pill tone={o.tone}>{o.text}</Pill>
                    <span className="text-xs text-faint">{t('触达', 'reached')} {it.notified}/{it.contacts}</span>
                    {it.lat != null && it.lon != null && (() => {
                      // 位置新鲜度诚实标注（与告警模态/看板/通知同 emergencyLocInfo）：回看时"最后已知"的兜底
                      // 坐标不冒充实时——复盘"当时我在哪"须能分辨实时点 vs 丢 GPS 时的旧点。
                      const loc = emergencyLocInfo({ locSource: it.locSource ?? undefined, locAgeSec: it.locAgeSec != null ? String(it.locAgeSec) : undefined }, it.at)
                      const label = loc.stale
                        ? (loc.fixAt != null ? t(`最后位置·${fmtTime(loc.fixAt, lang)}`, `Last·${fmtTime(loc.fixAt, lang)}`) : t('最后位置', 'Last known'))
                        : t('在地图查看', 'View on map')
                      return (
                        <a href={appleMapsUrl(it.lat, it.lon)} target="_blank" rel="noreferrer"
                          title={loc.stale && loc.fixAt != null ? t(`最后已知位置，定位于 ${fmtTime(loc.fixAt, lang)}`, `Last known location, fixed at ${fmtTime(loc.fixAt, lang)}`) : undefined}
                          className="text-xs text-accent underline">{loc.stale ? '⚠️ ' : ''}{label}</a>
                      )
                    })()}
                  </li>
                )
              })}
            </ul>
          ) : (
            <div className="text-xs text-faint">{t('暂无紧急事件记录', 'No emergencies on record')}</div>
          )}
        </div>
      )}
    </Card>
  )
}
