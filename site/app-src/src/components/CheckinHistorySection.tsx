import { useState } from 'react'
import { api, type CheckinHistoryItem } from '../lib/api'
import { useI18n } from '../lib/i18n'
import { RelativeTime, Pill } from './ui'

/// 报到历史区（SafetyCheckInCard 内，独立组件不碰卡片其余逻辑）：折叠式「查看历史」，展开时拉取近 30 条
/// 本人报到记录——含**已告警(fired)** 的那几次（错过报到、告警已发亲友），供本人复盘/安心。空历史不显条目。
function statusLabel(status: string, t: (z: string, e: string) => string): { text: string; tone: 'ok' | 'danger' | 'soft' | 'honey' } {
  switch (status) {
    case 'completed': return { text: t('已报平安', 'Marked safe'), tone: 'ok' }
    case 'fired': return { text: t('已告警亲友', 'Alerted contacts'), tone: 'danger' }
    case 'canceled': return { text: t('已取消', 'Canceled'), tone: 'soft' }
    case 'expired': return { text: t('已过期', 'Expired'), tone: 'soft' }
    case 'active': return { text: t('进行中', 'Active'), tone: 'honey' }
    default: return { text: status, tone: 'soft' }
  }
}

export function CheckinHistorySection() {
  const { t, lang } = useI18n()
  const [open, setOpen] = useState(false)
  const [items, setItems] = useState<CheckinHistoryItem[] | null>(null)
  const [loading, setLoading] = useState(false)

  const toggle = async () => {
    const next = !open
    setOpen(next)
    if (next && items === null && !loading) {
      setLoading(true)
      try { setItems((await api.checkinHistory()).history) }
      catch { setItems([]) }
      finally { setLoading(false) }
    }
  }

  return (
    <div className="mt-4 border-t border-[var(--line)] pt-3">
      <button type="button" onClick={() => void toggle()} aria-expanded={open}
        className="text-sm font-medium text-soft hover:text-honey">
        {open ? t('收起报到历史', 'Hide check-in history') : t('查看报到历史', 'View check-in history')}
      </button>
      {open && (
        <div className="mt-2">
          {loading ? (
            <div className="text-xs text-faint">{t('加载中…', 'Loading…')}</div>
          ) : items && items.length > 0 ? (
            <ul className="divide-y divide-[var(--line)]">
              {items.map((it) => {
                const s = statusLabel(it.status, t)
                return (
                  <li key={it.id} className="flex items-center gap-2 py-2 text-sm">
                    <Pill tone={s.tone}>{s.text}</Pill>
                    <RelativeTime ms={it.startedAt} lang={lang} className="text-faint" />
                    {it.note && <span className="min-w-0 truncate text-xs text-faint">· {it.note}</span>}
                  </li>
                )
              })}
            </ul>
          ) : (
            <div className="text-xs text-faint">{t('暂无报到记录', 'No check-ins yet')}</div>
          )}
        </div>
      )}
    </div>
  )
}
