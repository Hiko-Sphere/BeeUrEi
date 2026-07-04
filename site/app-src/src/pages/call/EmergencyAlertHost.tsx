import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type NotificationInfo } from '../../lib/api'
import { pickUnreadEmergencies, playEmergencyChime } from '../../lib/emergencyAlerts'
import { emergencyLocInfo } from '../../lib/emergencyLoc'
import { useI18n } from '../../lib/i18n'
import { Modal, fmtTime } from '../../components/ui'
import { IconPhone, IconFlash } from '../../components/icons'
import { useCall } from './CallController'

const POLL_MS = 10_000

/// 紧急告警的模态展示（纯展示，可组件测试）：谁、发生了什么、位置（诚实标注实时/最后已知）、
/// 一键回拨、确认。role=alertdialog 由 Modal 的 aria 承担；文案 zh/en。
export function EmergencyAlertModal({ alert, othersCount, onAck, onCallBack }: {
  alert: NotificationInfo
  othersCount: number          // 除当前外还有几条未读告警（提示"还有 N 条"）
  onAck: () => void            // 知道了：标已读，永不再弹
  onCallBack: () => void       // 回拨发出告警的盲人
}) {
  const { t, lang } = useI18n()
  const loc = emergencyLocInfo(alert.data ?? undefined, alert.createdAt)
  const hasCoord = !!(alert.data?.lat && alert.data?.lon)
  return (
    <Modal onClose={onAck} label={t('紧急告警', 'Emergency alert')} role="alertdialog" dismissible={false}>
      <div className="flex flex-col gap-3 p-1" data-testid="emergency-alert-modal">
        <div className="flex items-center gap-2 text-danger">
          <IconFlash />
          <h2 className="text-lg font-bold">{alert.title}</h2>
        </div>
        {alert.body && <p className="text-sm text-soft">{alert.body}</p>}
        <div className="text-xs text-faint">{fmtTime(alert.createdAt, lang)}</div>
        {hasCoord && (
          <a href={`https://maps.apple.com/?ll=${alert.data!.lat},${alert.data!.lon}&q=${alert.data!.lat},${alert.data!.lon}`}
            target="_blank" rel="noreferrer"
            className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline">
            {loc.stale ? '⚠️' : '📍'} {loc.stale
              ? (loc.fixAt != null
                ? t(`最后已知位置 · ${fmtTime(loc.fixAt, lang)}`, `Last known location · ${fmtTime(loc.fixAt, lang)}`)
                : t('最后已知位置（非实时）', 'Last known location (not live)'))
              : t('查看位置', 'View location')}
          </a>
        )}
        {othersCount > 0 && (
          <p className="text-xs text-faint">{t(`还有 ${othersCount} 条未读紧急告警，见通知页`, `${othersCount} more unread emergency alert(s) in Alerts`)}</p>
        )}
        <div className="mt-1 flex gap-2">
          {alert.data?.fromId && (
            <button onClick={onCallBack}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-danger px-4 py-2.5 font-semibold text-white hover:opacity-90">
              <IconPhone width={16} height={16} />{t(`回拨 ${alert.data.fromName ?? ''}`, `Call ${alert.data.fromName ?? 'back'}`)}
            </button>
          )}
          <button onClick={onAck}
            className="flex-1 rounded-xl border border-[var(--line)] px-4 py-2.5 font-medium hover:surface-2">
            {t('知道了', 'Acknowledge')}
          </button>
        </div>
      </div>
    </Modal>
  )
}

/// 全局紧急告警宿主（与 IncomingCallHost 同模式）：轮询通知，发现未读紧急告警即弹模态+三声蜂鸣。
/// 通话中不弹（不打断正在进行的救助通话）；"知道了"=标已读（服务端真相，跨设备不再弹）。
export function EmergencyAlertHost() {
  const { active, startOutgoing } = useCall()
  const { t } = useI18n()
  const [alerts, setAlerts] = useState<NotificationInfo[]>([])
  const dismissedRef = useRef<Set<string>>(new Set())
  const chimedRef = useRef<Set<string>>(new Set())
  const activeRef = useRef(active)
  activeRef.current = active

  useEffect(() => {
    let alive = true
    const tick = async () => {
      if (!alive || activeRef.current) return // 通话中不弹
      try {
        const { notifications } = await api.notifications()
        if (!alive) return
        const urgent = pickUnreadEmergencies(notifications, dismissedRef.current)
        setAlerts(urgent)
        // 只对首次见到的告警响铃（轮询重复到达不再响）。
        const fresh = urgent.filter((n) => !chimedRef.current.has(n.id))
        if (fresh.length > 0) {
          fresh.forEach((n) => chimedRef.current.add(n.id))
          playEmergencyChime()
        }
      } catch { /* 网络抖动忽略 */ }
    }
    void tick()
    const id = setInterval(tick, POLL_MS)
    return () => { alive = false; clearInterval(id) }
  }, [])

  const top = activeRef.current ? null : alerts[0] ?? null

  const ack = useCallback(() => {
    if (!top) return
    dismissedRef.current.add(top.id)
    setAlerts((cur) => cur.filter((n) => n.id !== top.id))
    void api.markNotifRead(top.id).catch(() => {}) // 失败也已会话内静默；下次刷新以服务端为准
    // 回告发起人"我已看到你的求助"（遇险者最需要的反馈）。best-effort：失败不影响本端"知道了"。
    if (top.data?.fromId) void api.emergencyAck(top.data.fromId, top.data.eventId ?? undefined).catch(() => {})
  }, [top])

  const callBack = useCallback(() => {
    if (!top?.data?.fromId) return
    const fromId = top.data.fromId
    const fromName = top.data.fromName ?? t('对方', 'Them')
    ack() // 回拨即视为已确认
    void startOutgoing(fromId, fromName, null)
  }, [top, ack, startOutgoing, t])

  if (!top) return null
  return <EmergencyAlertModal alert={top} othersCount={alerts.length - 1} onAck={ack} onCallBack={callBack} />
}
