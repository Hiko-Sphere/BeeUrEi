import { useCallback, useEffect, useState } from 'react'
import { api, type ActiveEmergency } from '../lib/api'
import { pollWhileVisible } from '../lib/poll'
import { useI18n } from '../lib/i18n'
import { appleMapsUrl } from '../lib/location'
import { emergencyLocInfo } from '../lib/emergencyLoc'
import { Card, Button, timeAgo, fmtTime, useToast } from './ui'
import { ContactMedicalInfo } from './ContactMedicalInfo'
import { IconPhone } from './icons'

/// 我负责的人当前未解除的紧急情况看板（helper 首页顶部）：漏看推送时的兜底——把"我是 accepted 紧急联系人"
/// 的那些人此刻未解除的告警聚合、置顶醒目。空则不渲染（只在需要行动时出现）。每 15s 轮询。onCall 由父页
/// 接 useCall.startOutgoing（本组件不碰 webrtc，便于单测）。
function kindLabel(kind: string, t: (z: string, e: string) => string): string {
  return kind === 'fall' ? t('疑似摔倒', 'Suspected fall') : kind === 'crash' ? t('疑似撞击', 'Suspected crash') : t('紧急求助 SOS', 'SOS')
}

export function ActiveEmergenciesBanner({ onCall }: { onCall?: (userId: string, name: string) => void }) {
  const { t, lang } = useI18n()
  const toast = useToast()
  const [active, setActive] = useState<ActiveEmergency[]>([])
  const [responded, setResponded] = useState<Set<string>>(new Set()) // 本会话已点"我在赶来"的 eventId

  const load = useCallback(() => { void api.watchingEmergencies().then((r) => setActive(r.active)).catch(() => { /* 网络失败：保留现状，不清空（不制造"已无紧急"的假安心） */ }) }, [])
  useEffect(() => { load(); return pollWhileVisible(load, 15000) }, [load])

  // 回应遇险者：onMyWay=true → "我在赶来"（更强安心信号）；false → "我已看到"（纯 ack）。两者都停止升级重呼、
  // 让遇险者知道有人在响应。补"我已看到"：远在外地/上班去不了的亲友，不必谎称"在赶来"或干等——ack 即可停升级、
  // 告知遇险者有人在协调（与通知页/告警弹窗的双回应口径对齐）。乐观反馈、失败回滚。
  const respond = async (e: ActiveEmergency, onMyWay: boolean) => {
    setResponded((prev) => new Set(prev).add(e.eventId)) // 乐观：立即反映，避免重复点
    try {
      await api.emergencyAck(e.ownerId, e.eventId, onMyWay)
      toast(onMyWay ? t(`已告诉 ${e.ownerName} 你在赶来`, `Told ${e.ownerName} you're on the way`) : t(`已回执，${e.ownerName} 会看到有人在响应`, `Acknowledged — ${e.ownerName} will see someone is responding`), 'ok')
    } catch { toast(t('操作失败，请重试', 'Failed — try again'), 'error'); setResponded((prev) => { const n = new Set(prev); n.delete(e.eventId); return n }) }
  }

  if (active.length === 0) return null
  return (
    <div role="alert"> {/* 整块作 alert 区：读屏即时朗读"有人处于紧急情况" */}
    <Card className="border border-danger/60 bg-danger/5 p-4">
      <div className="flex items-center gap-2 text-sm font-bold text-danger">
        <span aria-hidden>🆘</span>
        {t(`${active.length} 位你负责的人正处于紧急情况`, `${active.length} ${active.length > 1 ? 'people' : 'person'} you look after need${active.length > 1 ? '' : 's'} help`)}
      </div>
      <ul className="mt-3 space-y-3">
        {active.map((e) => (
          <li key={e.eventId} className="flex flex-wrap items-center gap-2 border-t border-danger/20 pt-3 first:border-0 first:pt-0">
            <span className="font-semibold">{e.ownerName}</span>
            <span className="text-sm text-danger">{kindLabel(e.kind, t)}</span>
            <span className="text-xs text-faint">{timeAgo(e.at, lang)}</span>
            {e.escalated && !e.acked && <span className="rounded-full bg-danger/15 px-1.5 py-0.5 text-[10px] font-bold text-danger">{t('升级后仍无人响应', 'Unanswered')}</span>}
            {/* "有人正在赶来"比"有人响应"更强的安心信号（有人已动身，非仅看到）：晚开 App 的其余亲友据此可安心待命，
                不必都赶去。与推送 emergencyRespondingOnMyWay 口径一致；服务端 onWayAt 持久化后此处才可显。 */}
            {e.onWay
              ? <span className="rounded-full bg-ok/20 px-1.5 py-0.5 text-[10px] font-bold text-ok">{t('有人正在赶来', 'Someone on the way')}</span>
              : e.acked && <span className="rounded-full bg-ok/15 px-1.5 py-0.5 text-[10px] font-bold text-ok">{t('有人响应', 'Responded')}</span>}
            <div className="ml-auto flex items-center gap-2">
              {e.lat != null && e.lon != null && (() => {
                // 位置新鲜度诚实标注（与 EmergencyAlertHost/通知同 emergencyLocInfo）：兜底的「最后已知」坐标
                // 绝不冒充实时——协助者要照此赶去，必须一眼看出是实时还是 N 分钟前的旧坐标，否则可能扑空。
                const loc = emergencyLocInfo({ locSource: e.locSource ?? undefined, locAgeSec: e.locAgeSec != null ? String(e.locAgeSec) : undefined }, e.at)
                const label = loc.stale
                  ? (loc.fixAt != null ? t(`最后位置·${fmtTime(loc.fixAt, lang)}`, `Last·${fmtTime(loc.fixAt, lang)}`) : t('最后位置', 'Last known'))
                  : t('位置', 'Map')
                return (
                  <a href={appleMapsUrl(e.lat, e.lon, e.ownerName)} target="_blank" rel="noreferrer"
                    title={loc.stale && loc.fixAt != null ? t(`最后已知位置，定位于 ${fmtTime(loc.fixAt, lang)}`, `Last known location, fixed at ${fmtTime(loc.fixAt, lang)}`) : undefined}
                    className="text-xs text-accent underline">{loc.stale ? '⚠️' : '📍'} {label}</a>
                )
              })()}
              {responded.has(e.eventId) ? (
                <span role="status" className="inline-flex items-center gap-1 text-xs font-medium text-ok">✓ {t('已回应', 'Responded')}</span>
              ) : (<>
                <Button variant="soft" onClick={() => void respond(e, true)}>{t('我在赶来', "I'm on my way")}</Button>
                {/* 纯回执：去不了的亲友也能停止升级重呼 + 告知遇险者有人在响应，不必谎称"在赶来"（与通知页双回应对齐）。 */}
                <Button variant="ghost" onClick={() => void respond(e, false)}>{t('我已看到', "I've seen it")}</Button>
              </>)}
              {onCall && (
                <Button variant="danger" onClick={() => onCall(e.ownerId, e.ownerName)}><IconPhone width={15} height={15} />{t('呼叫', 'Call')}</Button>
              )}
            </div>
            {/* 该人有紧急医疗信息 → 醒目按钮供施救者一键查看过敏/用药/病史（我是其紧急联系人、有权读）。 */}
            {e.hasMedical && <div className="w-full"><ContactMedicalInfo userId={e.ownerId} emphasize /></div>}
          </li>
        ))}
      </ul>
    </Card>
    </div>
  )
}
