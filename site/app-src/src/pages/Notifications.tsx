import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, type NotificationInfo } from '../lib/api'
import { emergencyLocInfo } from '../lib/emergencyLoc'
import { appleMapsUrl } from '../lib/location'
import { useI18n } from '../lib/i18n'
import { Card, Button, Spinner, EmptyState, fmtTime, RelativeTime } from '../components/ui'
import { IconBell, IconShield, IconPhone, IconUsers, IconFilm, IconFlash, IconPin, IconBattery, IconX } from '../components/icons'
import { useCall } from './call/CallController'
import { ContactMedicalInfo } from './call/EmergencyAlertHost'

/// 点击通知跳到"可操作页"：好友请求→亲友页（去接受/拒绝）、群变更→聊天页；其余无明确去处返回 null（仅标已读）。
/// 纯函数便于单测。
export function notifDestination(kind: string): string | null {
  // 账号/安全类**必须先判**（在 friend/link 之前）：安全告警 security_apple_linked/security_apple_unlinked
  // 含子串 "link"，若 friend/link 先命中会被错误送到 /family——而绑/解绑 Apple 登录该去 /account 复核/撤销。
  // 安全变更预警/医疗被查看/实名结果都归账户页。
  if (kind.includes('security') || kind.includes('medical') || kind.includes('kyc') || kind.includes('verif')) return '/account'
  // 被设为某人的紧急联系人：是**关系事件**（含子串 emergency 但不是 SOS 告警）——去亲友页看/管理谁把你设为紧急联系人。
  // 须显式命中，否则落到末尾 return null，和真正的 emergency_alert（有专属"查看位置/回拨"按钮、故意不整行跳）混为一谈、点了没去处。
  if (kind.includes('emergency_contact')) return '/family'
  if (kind.includes('friend') || kind.includes('link')) return '/family'
  if (kind.includes('group')) return '/chat'
  if (kind.includes('route')) return '/routes' // 路线通知 → 路线库页（查看/预览亲友新加的路线；执行仍在 iOS）
  if (kind.includes('place') || kind.includes('arrival') || kind.includes('battery')) return '/locations' // 到达/离开围栏(place_arrival/place_departure)/低电量 → 位置页看对方在哪
  return null
}

function iconFor(kind: string) {
  // 被设为紧急联系人=关系事件，用人形图标；**须在 emergency→闪电 之前判**，否则 emergency_contact_set 含子串
  // "emergency" 会误配成 SOS 告警闪电——把善意的"你被设为紧急联系人"渲染得像危险告警，并与真实告警视觉混淆。
  if (kind.includes('emergency_contact')) return <IconUsers />
  if (kind.includes('emergency')) return <IconFlash />
  if (kind.includes('battery')) return <IconBattery /> // 共享者低电量提醒
  if (kind.includes('call')) return <IconPhone />
  // 账号/安全/实名/举报/医疗类用盾牌——**须在 friend/link/group 之前判**：security_apple_linked/unlinked 含子串
  // "link"，若 friend/link 先命中会被错配成 IconUsers（人形），账号安全告警该用盾牌。
  if (kind.includes('report') || kind.includes('moderation') || kind.includes('ban') || kind.includes('kyc') || kind.includes('verif') || kind.includes('security') || kind.includes('medical')) return <IconShield />
  if (kind.includes('route') || kind.includes('arrival') || kind.includes('place')) return <IconPin /> // 路线库/到达围栏（route_added/place_arrival）用定位图标
  if (kind.includes('friend') || kind.includes('link') || kind.includes('group')) return <IconUsers />
  if (kind.includes('record')) return <IconFilm />
  return <IconBell />
}

export function NotificationsPage() {
  const { t, lang } = useI18n()
  const { active, startOutgoing } = useCall()
  const navigate = useNavigate()
  const [items, setItems] = useState<NotificationInfo[] | null>(null)

  const load = async () => { try { const r = await api.notifications(); setItems(r.notifications) } catch { setItems([]) } }
  useEffect(() => { void load() }, [])

  const markAll = async () => { try { await api.markAllNotifsRead(); void load() } catch { /* ignore */ } }
  const markOne = async (n: NotificationInfo) => { if (n.readAt) return; try { await api.markNotifRead(n.id); setItems((cur) => cur?.map((x) => x.id === n.id ? { ...x, readAt: Date.now() } : x) ?? cur) } catch { /* ignore */ } }
  // 点击通知：标已读 + 跳到可操作页（好友请求→亲友页接受、群变更→聊天页）。
  const onClickNotif = (n: NotificationInfo) => { void markOne(n); const dest = notifDestination(n.kind); if (dest) navigate(dest) }
  // 删除单条：乐观从列表移除（收件箱清理，仅本人；服务端幂等）。
  const deleteOne = async (n: NotificationInfo) => { setItems((cur) => cur?.filter((x) => x.id !== n.id) ?? cur); try { await api.deleteNotif(n.id) } catch { void load() } }
  // 清空已读：只清已看过的，保留未读（避免误清尚未看的紧急/求助提醒）。
  const clearRead = async () => { try { await api.clearReadNotifs(); void load() } catch { /* ignore */ } }

  const unread = (items ?? []).filter((n) => !n.readAt).length
  const hasRead = (items ?? []).some((n) => n.readAt)

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-bold tracking-tight">{t('通知', 'Notifications')}</h1>
        <div className="flex gap-2">
          {unread > 0 && <Button variant="soft" onClick={markAll}>{t('全部标为已读', 'Mark all read')}</Button>}
          {hasRead && <Button variant="ghost" onClick={clearRead}>{t('清空已读', 'Clear read')}</Button>}
        </div>
      </div>

      <Card className="overflow-hidden">
        {items === null ? <Spinner /> : items.length === 0 ? (
          <EmptyState icon={<IconBell />} title={t('暂无通知', 'No notifications')} message={t('举报处置、好友请求等会显示在这里', 'Reports, friend requests and more appear here')} />
        ) : (
          <ul className="divide-y divide-[var(--line)]">
            {items.map((n) => (
              <li key={n.id} className={`flex gap-3 px-4 py-3.5 ${n.readAt ? '' : 'bg-honey/5'}`}>
                <div className={`mt-0.5 shrink-0 ${n.readAt ? 'text-faint' : 'text-honey'}`}>{iconFor(n.kind)}</div>
                <div className="min-w-0 flex-1">
                  {/* 主操作(标已读+跳可操作页)做成 button：键盘/读屏可 Tab 聚焦 + Enter/Space 激活。
                      此前 onClick 挂在 <li> 上，对键盘/读屏完全不可达（同聊天会话行早先修过的一类）。
                      位置链接/回拨键是它的**兄弟**节点、不嵌套在按钮内——避免 nested-interactive 违规。 */}
                  <button type="button" onClick={() => onClickNotif(n)}
                    aria-label={notifDestination(n.kind) ? t(`${n.title}，打开`, `${n.title}, open`) : n.title}
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
                {/* 删除本条（收件箱清理）：独立按钮、非嵌套在主操作按钮内（避免 nested-interactive）。读屏可闻"删除通知"。 */}
                <button type="button" onClick={() => void deleteOne(n)}
                  className="mt-0.5 shrink-0 self-start rounded p-1 text-faint transition hover:text-danger hover:surface-2"
                  aria-label={t(`删除通知：${n.title}`, `Delete notification: ${n.title}`)}>
                  <IconX width={16} height={16} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
