import { useEffect, useState } from 'react'
import { api, type NotificationInfo } from '../lib/api'
import { useI18n } from '../lib/i18n'
import { Card, Button, Spinner, EmptyState, fmtTime } from '../components/ui'
import { IconBell, IconShield, IconPhone, IconUsers, IconFilm, IconFlash, IconPin } from '../components/icons'

function iconFor(kind: string) {
  if (kind.includes('emergency')) return <IconFlash />
  if (kind.includes('call')) return <IconPhone />
  if (kind.includes('route')) return <IconPin /> // 路线库通知（route_added）用定位图标
  if (kind.includes('friend') || kind.includes('link') || kind.includes('group')) return <IconUsers />
  // 实名认证（kyc_verified/kyc_rejected）与举报处置同属"账号/安全"类——用盾牌，免落到通用铃铛。
  if (kind.includes('report') || kind.includes('moderation') || kind.includes('ban') || kind.includes('kyc') || kind.includes('verif')) return <IconShield />
  if (kind.includes('record')) return <IconFilm />
  return <IconBell />
}

export function NotificationsPage() {
  const { t, lang } = useI18n()
  const [items, setItems] = useState<NotificationInfo[] | null>(null)

  const load = async () => { try { const r = await api.notifications(); setItems(r.notifications) } catch { setItems([]) } }
  useEffect(() => { void load() }, [])

  const markAll = async () => { try { await api.markAllNotifsRead(); void load() } catch { /* ignore */ } }
  const markOne = async (n: NotificationInfo) => { if (n.readAt) return; try { await api.markNotifRead(n.id); setItems((cur) => cur?.map((x) => x.id === n.id ? { ...x, readAt: Date.now() } : x) ?? cur) } catch { /* ignore */ } }

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
              <li key={n.id} onClick={() => markOne(n)} className={`flex cursor-pointer gap-3 px-4 py-3.5 transition hover:surface-2 ${n.readAt ? '' : 'bg-honey/5'}`}>
                <div className={`mt-0.5 shrink-0 ${n.readAt ? 'text-faint' : 'text-honey'}`}>{iconFor(n.kind)}</div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-medium">{n.title}</span>
                    {!n.readAt && <span className="h-2 w-2 shrink-0 rounded-full bg-honey" />}
                  </div>
                  {n.body && <p className="mt-0.5 text-sm text-soft">{n.body}</p>}
                  {n.data?.lat && n.data?.lon && (
                    // 紧急告警带坐标：协助者一键看地图定位（响应救助的关键信息）。
                    // 用 Apple Maps 而非 Google Maps：坐标为 WGS-84（iOS 只在导航时才转 GCJ-02），
                    // 而本 App 用户在国内——Google Maps 被墙且把 WGS-84 画在 GCJ-02 底图上会偏移约 500m；
                    // Apple Maps 网页版跨平台可开、境内自动纠偏，且与 iOS 告警/聊天位置链接口径一致。
                    <a href={`https://maps.apple.com/?ll=${n.data.lat},${n.data.lon}&q=${n.data.lat},${n.data.lon}`} target="_blank" rel="noreferrer"
                      onClick={(e) => e.stopPropagation()}
                      className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-honey hover:underline">
                      📍 {t('查看位置', 'View location')}
                    </a>
                  )}
                  <div className="mt-1 text-xs text-faint">{fmtTime(n.createdAt, lang)}</div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  )
}
