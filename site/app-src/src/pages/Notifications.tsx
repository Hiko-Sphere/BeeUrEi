import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, type NotificationInfo } from '../lib/api'
import { emergencyLocInfo } from '../lib/emergencyLoc'
import { useI18n } from '../lib/i18n'
import { Card, Button, Spinner, EmptyState, fmtTime, RelativeTime } from '../components/ui'
import { IconBell, IconShield, IconPhone, IconUsers, IconFilm, IconFlash, IconPin, IconBattery } from '../components/icons'
import { useCall } from './call/CallController'

/// 点击通知跳到"可操作页"：好友请求→亲友页（去接受/拒绝）、群变更→聊天页；其余无明确去处返回 null（仅标已读）。
/// 纯函数便于单测。
export function notifDestination(kind: string): string | null {
  if (kind.includes('friend') || kind.includes('link')) return '/family'
  if (kind.includes('group')) return '/chat'
  if (kind.includes('route')) return '/routes' // 路线通知 → 路线库页（查看/预览亲友新加的路线；执行仍在 iOS）
  if (kind.includes('arrival') || kind.includes('battery')) return '/locations' // 到达围栏/低电量 → 位置页看对方在哪
  if (kind.includes('kyc') || kind.includes('verif')) return '/account' // 实名结果 → 账户页实名认证区
  if (kind.includes('security')) return '/account' // 安全变更预警（改密/改邮箱/2FA）→ 账户页去处理
  return null
}

function iconFor(kind: string) {
  if (kind.includes('emergency')) return <IconFlash />
  if (kind.includes('battery')) return <IconBattery /> // 共享者低电量提醒
  if (kind.includes('call')) return <IconPhone />
  if (kind.includes('route') || kind.includes('arrival') || kind.includes('place')) return <IconPin /> // 路线库/到达围栏（route_added/place_arrival）用定位图标
  if (kind.includes('friend') || kind.includes('link') || kind.includes('group')) return <IconUsers />
  // 实名认证（kyc_verified/kyc_rejected）与举报处置同属"账号/安全"类——用盾牌，免落到通用铃铛。
  if (kind.includes('report') || kind.includes('moderation') || kind.includes('ban') || kind.includes('kyc') || kind.includes('verif') || kind.includes('security')) return <IconShield />
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

  const unread = (items ?? []).filter((n) => !n.readAt).length

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">{t('通知', 'Notifications')}</h1>
        {unread > 0 && <Button variant="soft" onClick={markAll}>{t('全部标为已读', 'Mark all read')}</Button>}
      </div>

      <Card className="overflow-hidden">
        {items === null ? <Spinner /> : items.length === 0 ? (
          <EmptyState icon={<IconBell />} title={t('暂无通知', 'No notifications')} message={t('举报处置、好友请求等会显示在这里', 'Reports, friend requests and more appear here')} />
        ) : (
          <ul className="divide-y divide-[var(--line)]">
            {items.map((n) => (
              <li key={n.id} onClick={() => onClickNotif(n)} className={`flex cursor-pointer gap-3 px-4 py-3.5 transition hover:surface-2 ${n.readAt ? '' : 'bg-honey/5'}`}>
                <div className={`mt-0.5 shrink-0 ${n.readAt ? 'text-faint' : 'text-honey'}`}>{iconFor(n.kind)}</div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{n.title}</span>
                    {!n.readAt && <span className="h-2 w-2 shrink-0 rounded-full bg-honey" />}
                  </div>
                  {n.body && <p className="mt-0.5 text-sm text-soft">{n.body}</p>}
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
                      <a href={`https://maps.apple.com/?ll=${n.data.lat},${n.data.lon}&q=${n.data.lat},${n.data.lon}`} target="_blank" rel="noreferrer"
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
                  <RelativeTime ms={n.createdAt} lang={lang} className="mt-1 block text-xs text-faint" />
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
