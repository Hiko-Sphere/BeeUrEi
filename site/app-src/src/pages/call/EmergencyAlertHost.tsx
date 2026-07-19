import { useCallback, useEffect, useRef, useState } from 'react'
import { api, type NotificationInfo } from '../../lib/api'
import { pickUnreadEmergencies, playEmergencyChime, clearedSenderLatest, isClearedByLaterAllClear, ackEventNotifIds, respondingEventIds } from '../../lib/emergencyAlerts'
import { emergencyLocInfo } from '../../lib/emergencyLoc'
import { plural } from '../../lib/plural'
import { appleMapsUrl, appleMapsDirectionsUrl } from '../../lib/location'
import { useI18n } from '../../lib/i18n'
import { Modal, fmtTime } from '../../components/ui'
import { IconPhone, IconFlash, IconCheck } from '../../components/icons'
import { useCall } from './CallController'
import { ContactMedicalInfo } from '../../components/ContactMedicalInfo'

const POLL_MS = 10_000

// ContactMedicalInfo 已抽到 components/ContactMedicalInfo（解耦 useCall）；此处 re-export 保持既有 import 兼容。
export { ContactMedicalInfo } from '../../components/ContactMedicalInfo'

/// 紧急告警的模态展示（纯展示，可组件测试）：谁、发生了什么、位置（诚实标注实时/最后已知）、
/// 一键回拨、确认。role=alertdialog 由 Modal 的 aria 承担；文案 zh/en。
export function EmergencyAlertModal({ alert, othersCount, beingHandled, onAck, onOnMyWay, onCallBack }: {
  alert: NotificationInfo
  othersCount: number          // 除当前外还有几条未读告警（提示"还有 N 条"）
  beingHandled?: boolean       // 已有其他亲友在响应此事件（提示协调，不消模态——本人仍可继续帮忙）
  onAck: () => void            // 知道了：标已读，永不再弹
  onOnMyWay?: () => void       // 我在赶来：回告"X 正在赶来"（比"知道了"更进一步——遇险者知救援真在路上）+ 标已读
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
        {beingHandled && (
          // 已有其他亲友在响应：协调提示（用达标的 text-ok 承载，非仅靠颜色——文案本身表意）。不消模态。
          <p className="inline-flex items-center gap-1.5 text-sm font-medium text-ok" data-testid="emergency-being-handled">
            <IconCheck width={15} height={15} />{t('已有其他亲友在响应——若你也能帮忙可继续，否则可放心', 'Another contact is responding — you can still help, or stand by')}
          </p>
        )}
        <div className="text-xs text-faint">{fmtTime(alert.createdAt, lang)}</div>
        {hasCoord && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <a href={appleMapsUrl(alert.data!.lat, alert.data!.lon)}
              target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline">
              {loc.stale ? '⚠️' : '📍'} {loc.stale
                ? (loc.fixAt != null
                  ? t(`最后已知位置 · ${fmtTime(loc.fixAt, lang)}`, `Last known location · ${fmtTime(loc.fixAt, lang)}`)
                  : t('最后已知位置（非实时）', 'Last known location (not live)'))
                : t('查看位置', 'View location')}
            </a>
            {/* 一键导航前往（daddr）：收到 SOS 的家人最需要**立刻赶去**——比落图钉少一步（承 iter323/324）。
                位置陈旧已由左侧图钉 ⚠️ 标注，title 再提醒可能已移动。 */}
            <a href={appleMapsDirectionsUrl(alert.data!.lat, alert.data!.lon)} target="_blank" rel="noreferrer"
              title={loc.stale ? t('导航到最后已知位置（对方可能已移动）', 'Directions to last known location (they may have moved)') : t('导航前往（在地图中选驾车/步行）', 'Get directions (choose driving/walking in Maps)')}
              className="inline-flex items-center gap-1 text-sm font-medium text-accent hover:underline">
              🧭 {t('导航前往', 'Directions')}
            </a>
          </div>
        )}
        {othersCount > 0 && (
          <p className="text-xs text-faint">{t(`还有 ${othersCount} 条未读紧急告警，见通知页`, `${othersCount} more unread emergency ${plural(othersCount, 'alert')} in Alerts`)}</p>
        )}
        {/* 施救辅助：按需查看遇险者的紧急医疗信息（授权在服务端，仅其紧急联系人可读）。
            hasMedical=1（发起人确有医疗信息）→ 醒目提示，避免施救者忽略。 */}
        {alert.data?.fromId && <ContactMedicalInfo key={alert.data.fromId} userId={alert.data.fromId} emphasize={!!alert.data.hasMedical} />}
        <div className="mt-1 flex flex-col gap-2">
          <div className="flex gap-2">
            {alert.data?.fromId && (
              <button onClick={onCallBack}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-danger px-4 py-2.5 font-semibold text-white hover:opacity-90">
                <IconPhone width={16} height={16} />{t(`回拨 ${alert.data.fromName ?? ''}`, `Call ${alert.data.fromName ?? 'back'}`)}
              </button>
            )}
            {/* "我在赶来"：比"知道了"更进一步——遇险者据此知救援真在路上、可安心等待；其余亲友也收到"有人已动身"。 */}
            {alert.data?.fromId && onOnMyWay && (
              <button onClick={onOnMyWay}
                className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-[var(--line)] px-4 py-2.5 font-semibold text-ok hover:surface-2">
                {t('我在赶来', "I'm on my way")}
              </button>
            )}
          </div>
          <button onClick={onAck}
            className="w-full rounded-xl border border-[var(--line)] px-4 py-2.5 font-medium hover:surface-2">
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
  const [respondingEvents, setRespondingEvents] = useState<ReadonlySet<string>>(new Set()) // 已有人在响应的事件 id
  const notifsRef = useRef<NotificationInfo[]>([]) // 上轮完整通知列表：确认时据此收敛同事件的兄弟告警
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
        notifsRef.current = notifications // 存下完整列表：确认时按 eventId 收敛同事件兄弟告警
        // 发起人已报平安(emergency_clear)的告警就地消掉——对方已没事，让担心的亲友立刻安心，不再弹/响。
        // 按**时刻**比对：只消掉早于该发起人最近一次报平安的告警；其报平安**之后**再发的新告警(二次摔倒/求助)照弹。
        const clearedAt = clearedSenderLatest(notifications)
        const urgent = pickUnreadEmergencies(notifications, dismissedRef.current)
          .filter((n) => !isClearedByLaterAllClear(n, clearedAt))
        setAlerts(urgent)
        setRespondingEvents(respondingEventIds(notifications)) // 已有人在响应的事件（模态显示协调提示）
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

  const ack = useCallback((onMyWay = false) => {
    if (!top) return
    // 收敛同一事件的**全部**告警通知（首呼 + 升级重呼）：只标 top 一条会让另一条下轮重新弹（详见 ackEventNotifIds）。
    const ids = ackEventNotifIds(notifsRef.current, top)
    ids.forEach((id) => dismissedRef.current.add(id))
    setAlerts((cur) => cur.filter((n) => !ids.includes(n.id)))
    ids.forEach((id) => void api.markNotifRead(id).catch(() => {})) // 失败也已会话内静默；下次刷新以服务端为准
    // 回告发起人。onMyWay=true → "X 正在赶来"（更进一步的安心信号）；否则"我已看到你的求助"。best-effort：失败不影响本端关闭弹窗。
    // === true 显式判：防调用方误把 onClick 的事件对象当 onMyWay 传入（真值污染）。
    if (top.data?.fromId) void api.emergencyAck(top.data.fromId, top.data.eventId ?? undefined, onMyWay === true).catch(() => {})
  }, [top])

  const callBack = useCallback(async () => {
    if (!top?.data?.fromId) return
    const fromId = top.data.fromId
    const fromName = top.data.fromName ?? t('对方', 'Them')
    // **先发起通话，成功启动才视为已确认**。此前顺序相反：先 ack(标已读+从看板消掉)再发起——呼叫被"已有通话/
    // 守则未接受/注册失败"挡下时，SOS 已被静默清除、也标了服务端已读，却无人真正拨打（见对抗复审）。失败则
    // 保留告警，供本人重试或其他亲友响应。
    if (await startOutgoing(fromId, fromName, null)) ack() // 回拨成功发起 → 视为已确认
  }, [top, ack, startOutgoing, t])

  if (!top) return null
  const beingHandled = !!(top.data?.eventId && respondingEvents.has(top.data.eventId))
  return <EmergencyAlertModal alert={top} othersCount={alerts.length - 1} beingHandled={beingHandled} onAck={() => ack(false)} onOnMyWay={() => ack(true)} onCallBack={callBack} />
}
