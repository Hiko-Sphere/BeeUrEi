import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, type NotificationInfo } from '../lib/api'
import { pollWhileVisible } from '../lib/poll'
import { emergencyLocInfo } from '../lib/emergencyLoc'
import { appleMapsUrl } from '../lib/location'
import { useI18n } from '../lib/i18n'
import { Card, Button, Spinner, EmptyState, fmtTime, RelativeTime, useToast } from '../components/ui'
import { IconBell, IconShield, IconPhone, IconUsers, IconFilm, IconFlash, IconPin, IconBattery, IconX, IconCheck } from '../components/icons'
import { useCall } from './call/CallController'
import { ContactMedicalInfo } from './call/EmergencyAlertHost'

/// 点击通知跳到"可操作页"：好友请求→亲友页（去接受/拒绝）、群变更→聊天页；其余无明确去处返回 null（仅标已读）。
/// 纯函数便于单测。
export function notifDestination(kind: string, data?: Record<string, string> | null): string | null {
  // 账号/安全类**必须先判**（在 friend/link 之前）：安全告警 security_apple_linked/security_apple_unlinked
  // 含子串 "link"，若 friend/link 先命中会被错误送到 /family——而绑/解绑 Apple 登录该去 /account 复核/撤销。
  // 安全变更预警/医疗被查看/实名结果都归账户页。
  if (kind.includes('security') || kind.includes('medical') || kind.includes('kyc') || kind.includes('verif')) return '/account'
  // 被设为某人的紧急联系人：是**关系事件**（含子串 emergency 但不是 SOS 告警）——去亲友页看/管理谁把你设为紧急联系人。
  // 须显式命中，否则落到末尾 return null，和真正的 emergency_alert（有专属"查看位置/回拨"按钮、故意不整行跳）混为一谈、点了没去处。
  if (kind.includes('emergency_contact')) return '/family'
  // 安全报到提醒/超时（本人收到"快到期，请报平安"/"已超时"）→ 亲友页：SafetyCheckInCard（报平安/延长/重开）就在那里。
  // 此前落到 null——点了没去处，而这条通知的全部意义就是"去操作报到"。
  if (kind.includes('checkin')) return '/family'
  if (kind.includes('friend') || kind.includes('link')) return '/family'
  // 会话类通知（群成员变动 group_*、置顶 message_pinned）→ **直达对应会话**（群走 iter123 的 /chat/g/:id 深链、
  // 单聊 /chat/:peerId），data 里带 groupId/fromId。此前群类一律落聊天列表、置顶通知无去处（null）——点了还得自己找。
  if (kind.includes('group') || kind === 'message_pinned') {
    // 例外：group_removed（你被移出）/group_dissolved（群已解散）——你已进不去那个群，深链会 403/空，落聊天列表。
    if (kind === 'group_removed' || kind === 'group_dissolved') return '/chat'
    if (data?.groupId) return `/chat/g/${encodeURIComponent(data.groupId)}`
    if (data?.fromId) return `/chat/${encodeURIComponent(data.fromId)}`
    return '/chat'
  }
  if (kind.includes('route')) return '/routes' // 路线通知 → 路线库页（查看/预览亲友新加的路线；执行仍在 iOS）
  if (kind.includes('place') || kind.includes('arrival') || kind.includes('battery')) return '/locations' // 到达/离开围栏(place_arrival/place_departure)/低电量 → 位置页看对方在哪
  // 有人请求你共享位置（去开开关）/ 你请求的人开始共享了（去地图看对方）→ 均落位置页。
  if (kind === 'location_request' || kind === 'location_share_started') return '/locations'
  return null
}

/// 通知图标选择（纯函数、可单测）：kind → 图标键。与 notifDestination 同属"服务端发的每个 kind 都有意为之的
/// web 呈现"——**图标须与去处语义一致**（location_request 去 /locations，就该用定位图标而非默认铃铛）。iconFor 只做
/// 键→组件映射，选择逻辑集中在此以便回归测试（此前 iconFor 返回 JSX 无法直接断言，location_request 漏配才没被测出）。
/// 顺序敏感：见各分支注释（emergency_contact 须先于 emergency；security 系须先于 friend/link）。
export type NotifIconKind = 'users' | 'flash' | 'battery' | 'phone' | 'shield' | 'pin' | 'film' | 'bell'
export function notifIconKind(kind: string): NotifIconKind {
  // 被设为紧急联系人=关系事件，用人形图标；**须在 emergency→闪电 之前判**，否则 emergency_contact_set 含子串
  // "emergency" 会误配成 SOS 告警闪电——把善意的"你被设为紧急联系人"渲染得像危险告警，并与真实告警视觉混淆。
  if (kind.includes('emergency_contact')) return 'users'
  if (kind.includes('emergency')) return 'flash'
  if (kind.includes('battery')) return 'battery' // 共享者低电量提醒
  if (kind.includes('call')) return 'phone'
  // 账号/安全/实名/举报/医疗类用盾牌——**须在 friend/link/group 之前判**：security_apple_linked/unlinked 含子串
  // "link"，若 friend/link 先命中会被错配成 IconUsers（人形），账号安全告警该用盾牌。
  if (kind.includes('report') || kind.includes('moderation') || kind.includes('ban') || kind.includes('kyc') || kind.includes('verif') || kind.includes('security') || kind.includes('medical')) return 'shield'
  // 安全报到（平安打卡开始/到期提醒/已超时，全部发给报到本人）：盾牌＝personal-safety 保护语义，与其去处
  // /family 的 SafetyCheckInCard 一致。此前落到末尾默认铃铛——一个安全攸关的 dead-man's switch 状态被渲染得与
  // 普通提醒无异、在通知流里难以一眼辨识。须在 friend/link 之前判（checkin 不含这些子串，纯为语义分组清晰）。
  if (kind.includes('checkin')) return 'shield'
  // 位置/路线/围栏类用定位图标：route_added/place_arrival/**location_request**（有人请求你共享位置，去处即 /locations、
  // RequestShareList 里也用同款定位图标）。此前漏了 location_request——它不含 route/arrival/place，落到末尾默认铃铛，
  // 与其"位置"语义+/locations 去处不一致。加 `location` 子串一并覆盖当前与未来的 location_* 类。
  if (kind === 'message_pinned') return 'pin' // 置顶消息通知：📌 图标（去处=对应会话，图标与"置顶"语义一致，非默认铃铛）
  if (kind.includes('route') || kind.includes('arrival') || kind.includes('place') || kind.includes('location')) return 'pin'
  if (kind.includes('friend') || kind.includes('link') || kind.includes('group')) return 'users'
  if (kind.includes('record')) return 'film'
  return 'bell'
}

function iconFor(kind: string) {
  switch (notifIconKind(kind)) {
    case 'users': return <IconUsers />
    case 'flash': return <IconFlash />
    case 'battery': return <IconBattery />
    case 'phone': return <IconPhone />
    case 'shield': return <IconShield />
    case 'pin': return <IconPin />
    case 'film': return <IconFilm />
    default: return <IconBell />
  }
}

export function NotificationsPage() {
  const { t, lang } = useI18n()
  const { active, startOutgoing } = useCall()
  const navigate = useNavigate()
  const toast = useToast()
  const [items, setItems] = useState<NotificationInfo[] | null>(null)
  const [ackedIds, setAckedIds] = useState<Set<string>>(new Set()) // 本会话内已从列表回执的告警（立即显示"已回执"）
  const [filter, setFilter] = useState<'all' | 'unread' | 'emergency'>('all') // 筛选：全部/未读/紧急——多人多事件时快速聚焦安全攸关或未处理的
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const expandedRef = useRef(false) // 是否已"加载更多"：展开后轮询合并头尾并保留 hasMore（否则每 15s 把更早页刷掉）

  const load = async () => {
    try {
      const r = await api.notifications()
      // 未展开：直接替换为首屏（保持原行为）。展开：用首屏刷新"头部"（拾取服务端已读态/新到），保留更早页的"尾部"。
      setItems((prev) => {
        if (!prev || !expandedRef.current) return r.notifications
        const fresh = r.notifications
        const oldest = fresh[fresh.length - 1]
        const freshIds = new Set(fresh.map((n) => n.id))
        const tail = prev.filter((n) => !freshIds.has(n.id) && (n.createdAt < (oldest?.createdAt ?? 0) || (oldest && n.createdAt === oldest.createdAt && n.id < oldest.id)))
        return [...fresh, ...tail]
      })
      if (!expandedRef.current) setHasMore(!!r.hasMore) // 展开后 hasMore 由 loadMore 维护，不被轮询翻回
    } catch { setItems((c) => c ?? []) }
  }
  // 轮询刷新收件箱（与 Locations/Chat/紧急看板等所有列表面一致）：家人开着通知页时，新到的可操作通知
  // （请求共享位置/SOS 回执/报到提醒等）会自动出现，无需手动刷新——尤其未授予 Web Push 的用户，此页是唯一入口。
  // 前台可见才拉、切回即刷（pollWhileVisible）。乐观态（ackedIds/已读）是独立 state，不被重拉清掉。
  useEffect(() => { void load(); return pollWhileVisible(load, 15000) }, [])

  // 加载更多：以当前列表最后一条（最早）为游标向前翻页，追加更早的通知。通知列表此前硬顶最近 100 条无从翻看更早。
  const loadMore = async () => {
    const last = items && items[items.length - 1]
    if (!last || loadingMore) return
    setLoadingMore(true)
    expandedRef.current = true
    try {
      const r = await api.notifications({ before: last.createdAt, beforeId: last.id })
      setItems((prev) => {
        const seen = new Set((prev ?? []).map((n) => n.id))
        return [...(prev ?? []), ...r.notifications.filter((n) => !seen.has(n.id))]
      })
      setHasMore(!!r.hasMore)
    } catch { /* 忽略；用户可再点 */ } finally { setLoadingMore(false) }
  }

  // 从通知列表直接回执 SOS 告警："我已看到"——遇险者最需要的反馈是"有人在响应"，且服务端据此停止升级重呼、
  // 匿名协调其余亲友（与告警弹窗 onAck 同一后端流程）。此前列表只有"回拨"、没有"回执"，与弹窗不对等（尤其读屏
  // 用户逐条浏览列表时够不着回执）。best-effort + 幂等：乐观显示"已回执"，失败回滚并提示。
  const acknowledge = async (n: NotificationInfo, onMyWay = false) => {
    if (!n.data?.fromId) return
    setAckedIds((prev) => new Set(prev).add(n.id))
    try {
      await api.emergencyAck(n.data.fromId, n.data.eventId, onMyWay)
      toast(onMyWay ? t('已告知对方你正在赶来', "They'll see you're on the way") : t('已回执，对方会看到你在响应', "Acknowledged — they'll see you're responding"), 'ok')
    } catch { setAckedIds((prev) => { const s = new Set(prev); s.delete(n.id); return s }); toast(t('回执失败，请重试', 'Failed, please try again'), 'error') }
  }

  const markAll = async () => { try { await api.markAllNotifsRead(); void load() } catch { /* ignore */ } }
  const markOne = async (n: NotificationInfo) => { if (n.readAt) return; try { await api.markNotifRead(n.id); setItems((cur) => cur?.map((x) => x.id === n.id ? { ...x, readAt: Date.now() } : x) ?? cur) } catch { /* ignore */ } }
  // 点击通知：标已读 + 跳到可操作页（好友请求→亲友页接受、群变更→聊天页）。
  const onClickNotif = (n: NotificationInfo) => { void markOne(n); const dest = notifDestination(n.kind, n.data); if (dest) navigate(dest) }
  // 删除单条：乐观从列表移除（收件箱清理，仅本人；服务端幂等）。
  // 焦点接力（读屏逐条清理不迷路）：被点的删除键随行卸载、焦点会丢到 body——删除前按 **DOM 渲染序**
  // 记下相邻行的删除键（天然尊重当前筛选），删完聚焦它；删的是最后一条则聚焦页标题（tabindex=-1）。
  const deleteOne = async (n: NotificationInfo) => {
    const btns = [...document.querySelectorAll<HTMLElement>('[data-notif-del]')]
    const idx = btns.findIndex((b) => b.dataset.notifDel === n.id)
    const nextId = (btns[idx + 1] ?? btns[idx - 1])?.dataset.notifDel ?? null
    setItems((cur) => cur?.filter((x) => x.id !== n.id) ?? cur)
    setTimeout(() => { // 等移除后的 DOM 落定再接力焦点
      const target = nextId ? document.querySelector<HTMLElement>(`[data-notif-del="${nextId}"]`) : null
      ;(target ?? document.getElementById('notifs-heading'))?.focus()
    }, 0)
    try { await api.deleteNotif(n.id) } catch { void load() }
  }
  // 清空已读：只清已看过的，保留未读（避免误清尚未看的紧急/求助提醒）。
  const clearRead = async () => { try { await api.clearReadNotifs(); void load() } catch { /* ignore */ } }

  const unread = (items ?? []).filter((n) => !n.readAt).length
  const hasRead = (items ?? []).some((n) => n.readAt)
  // 紧急=kind 含 'emergency'（SOS 告警/回执/协调/报平安/被设为紧急联系人一类）——安全攸关，值得单独一屏聚焦。
  const shown = (items ?? []).filter((n) => filter === 'unread' ? !n.readAt : filter === 'emergency' ? n.kind.includes('emergency') : true)

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-2">
        {/* tabindex=-1：删除最后一条通知后的焦点兜底锚（deleteOne 无相邻行可接力时聚焦此处，读屏不迷路）。 */}
        <h1 id="notifs-heading" tabIndex={-1} className="text-2xl font-bold tracking-tight outline-none">{t('通知', 'Notifications')}</h1>
        <div className="flex gap-2">
          {unread > 0 && <Button variant="soft" onClick={markAll}>{t('全部标为已读', 'Mark all read')}</Button>}
          {hasRead && <Button variant="ghost" onClick={clearRead}>{t('清空已读', 'Clear read')}</Button>}
        </div>
      </div>

      {/* 筛选：多人多事件时快速聚焦未读或安全攸关的紧急项。仅在有通知时出现。aria-pressed 供读屏播报当前所选。 */}
      {items && items.length > 0 && (
        <div className="flex gap-1.5" role="group" aria-label={t('筛选通知', 'Filter notifications')}>
          {([['all', t('全部', 'All')], ['unread', t('未读', 'Unread')], ['emergency', t('紧急', 'Emergency')]] as const).map(([key, label]) => (
            <button key={key} type="button" aria-pressed={filter === key} onClick={() => setFilter(key)}
              className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${filter === key ? 'bg-honey text-ink' : 'surface-2 text-soft hover:brightness-105'}`}>
              {label}{key === 'unread' && unread > 0 ? ` (${unread})` : ''}
            </button>
          ))}
        </div>
      )}

      <Card className="overflow-hidden">
        {items === null ? <Spinner /> : items.length === 0 ? (
          <EmptyState icon={<IconBell />} title={t('暂无通知', 'No notifications')} message={t('举报处置、好友请求等会显示在这里', 'Reports, friend requests and more appear here')} />
        ) : shown.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-faint" role="status">
            {filter === 'unread' ? t('没有未读通知', 'No unread notifications') : filter === 'emergency' ? t('没有紧急通知', 'No emergency notifications') : t('暂无通知', 'No notifications')}
          </p>
        ) : (
          <ul className="divide-y divide-[var(--line)]">
            {shown.map((n) => (
              <li key={n.id} className={`flex gap-3 px-4 py-3.5 ${n.readAt ? '' : 'bg-honey/5'}`}>
                <div className={`mt-0.5 shrink-0 ${n.readAt ? 'text-faint' : 'text-honey'}`}>{iconFor(n.kind)}</div>
                <div className="min-w-0 flex-1">
                  {/* 主操作(标已读+跳可操作页)做成 button：键盘/读屏可 Tab 聚焦 + Enter/Space 激活。
                      此前 onClick 挂在 <li> 上，对键盘/读屏完全不可达（同聊天会话行早先修过的一类）。
                      位置链接/回拨键是它的**兄弟**节点、不嵌套在按钮内——避免 nested-interactive 违规。 */}
                  <button type="button" onClick={() => onClickNotif(n)}
                    aria-label={notifDestination(n.kind, n.data) ? t(`${n.title}，打开`, `${n.title}, open`) : n.title}
                    className="-mx-1 block w-full rounded px-1 text-left transition hover:surface-2">
                    <div className="flex items-center gap-2">
                      <span className="truncate font-medium">{n.title}</span>
                      {!n.readAt && <span className="h-2 w-2 shrink-0 rounded-full bg-honey" />}
                    </div>
                    {n.body && <p className="mt-0.5 text-sm text-soft">{n.body}</p>}
                  </button>
                  {n.data?.lat && n.data?.lon && (() => {
                    // 紧急告警带坐标：协助者一键看地图定位（响应救助的关键信息）。
                    // 用 Apple Maps 而非 Google Maps：坐标为 WGS-84（iOS 只在导航时才转 GCJ-02），
                    // 而本 App 用户在国内——Google Maps 被墙且把 WGS-84 画在 GCJ-02 底图上会偏移约 500m；
                    // Apple Maps 网页版跨平台可开、境内自动纠偏，且与 iOS 告警/聊天位置链接口径一致。
                    // 诚实标注（emergencyLocInfo，已单测）：服务端兜底的「最后已知位置」绝不能伪装成实时
                    // 定位——协助者会赶去错误地点。stale 时 ⚠️+"最后已知"+绝对定位时刻（"5 分钟前"会随阅读
                    // 时刻漂移成谎言，绝对时刻永远为真）。色仍用达标 text-accent：--color-warn 是裸蜂蜜色，
                    // 浅底小字对比度不达标（a11y 审计口径），诚实信号由文案而非颜色承载。
                    const loc = emergencyLocInfo(n.data, n.createdAt)
                    return (
                      <a href={appleMapsUrl(n.data.lat, n.data.lon)} target="_blank" rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline">
                        {loc.stale ? '⚠️' : '📍'} {loc.stale
                          ? (loc.fixAt != null
                            ? t(`最后已知位置 · ${fmtTime(loc.fixAt, lang)}`, `Last known location · ${fmtTime(loc.fixAt, lang)}`)
                            : t('最后已知位置（非实时）', 'Last known location (not live)'))
                          : t('查看位置', 'View location')}
                      </a>
                    )
                  })()}
                  {/* 回执"我已看到"：只对**收到的** SOS 告警(emergency_alert)显示——回告遇险者有人在响应 + 停止升级重呼。
                      与告警弹窗的"知道了"同一后端流程，补齐列表侧对等（弹窗错过/读屏逐条浏览时也能回执）。幂等，乐观反馈。 */}
                  {n.kind === 'emergency_alert' && n.data?.fromId && (
                    ackedIds.has(n.id) ? (
                      <span className="ml-3 mt-1 inline-flex items-center gap-1 text-xs font-medium text-ok" role="status">
                        <IconCheck width={13} height={13} />{t('已回执', 'Acknowledged')}
                      </span>
                    ) : (<>
                      {/* "我在赶来"（更进一步、更醒目）：遇险者据此知救援真在路上、可安心等待——比"已看到"更关键的安心信号。 */}
                      <button onClick={(e) => { e.stopPropagation(); void acknowledge(n, true) }}
                        className="ml-3 mt-1 inline-flex items-center gap-1 text-xs font-medium text-ok hover:underline"
                        aria-label={t(`我正赶去帮 ${n.data.fromName ?? ''}`, `Tell ${n.data.fromName ?? 'them'} you're on the way`)}>
                        <IconPhone width={13} height={13} />{t('我在赶来', "I'm on my way")}
                      </button>
                      <button onClick={(e) => { e.stopPropagation(); void acknowledge(n) }}
                        className="ml-2 mt-1 inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline"
                        aria-label={t(`回执：告诉 ${n.data.fromName ?? ''} 我已看到求助`, `Let ${n.data.fromName ?? 'them'} know you've seen the alert`)}>
                        <IconCheck width={13} height={13} />{t('我已看到', "I've seen it")}
                      </button>
                    </>)
                  )}
                  {/* 紧急告警：一键回拨发出告警的盲人——协助者响应摔倒/求助最直接的动作，免去手动翻联系人。 */}
                  {n.kind.includes('emergency') && n.data?.fromId && (
                    <button onClick={(e) => { e.stopPropagation(); void startOutgoing(n.data!.fromId!, n.data!.fromName ?? t('对方', 'Them'), null) }}
                      disabled={!!active}
                      className="ml-3 mt-1 inline-flex items-center gap-1 text-xs font-medium text-ok hover:underline disabled:opacity-40 disabled:no-underline disabled:cursor-not-allowed"
                      aria-label={t(`回拨 ${n.data.fromName ?? ''}`, `Call ${n.data.fromName ?? 'back'}`)}>
                      <IconPhone width={13} height={13} />{t('回拨', 'Call back')}
                    </button>
                  )}
                  {/* 施救医疗信息（与告警模态一致）：告警不止在弹窗现身，也持久留在通知列表——协助者事后回看这条
                      SOS 时同样需要能查遇险者的血型/过敏/用药（授权在服务端，仅其紧急联系人可读）。fromId 门天然
                      排除 emergency_contact_set（无 fromId），只对真 SOS 显示。 */}
                  {n.kind.includes('emergency') && n.data?.fromId && (
                    <div className="mt-1.5"><ContactMedicalInfo userId={n.data.fromId} emphasize={!!n.data.hasMedical} /></div>
                  )}
                  <RelativeTime ms={n.createdAt} lang={lang} className="mt-1 block text-xs text-faint" />
                </div>
                {/* 删除本条（收件箱清理）：独立按钮、非嵌套在主操作按钮内（避免 nested-interactive）。读屏可闻"删除通知"。
                    data-notif-del：焦点接力锚（见 deleteOne——逐条清理时焦点移到相邻行，不丢到 body）。 */}
                <button type="button" onClick={() => void deleteOne(n)} data-notif-del={n.id}
                  className="mt-0.5 shrink-0 self-start rounded p-1 text-faint transition hover:text-danger hover:surface-2"
                  aria-label={t(`删除通知：${n.title}`, `Delete notification: ${n.title}`)}>
                  <IconX width={16} height={16} />
                </button>
              </li>
            ))}
          </ul>
        )}
        {/* 加载更多：通知此前硬顶最近 100 条、无从翻看更早（silent cap）。有更早通知时给出翻页入口——
            即便当前筛选（未读/紧急）此刻为空，也可加载更早的以找到超窗的未读/紧急通知。 */}
        {hasMore && items && items.length > 0 && (
          <div className="border-t border-[var(--line)] p-3 text-center">
            <Button variant="soft" loading={loadingMore} onClick={loadMore}>{t('加载更多', 'Load more')}</Button>
          </div>
        )}
      </Card>
    </div>
  )
}
