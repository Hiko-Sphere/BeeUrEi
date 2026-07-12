import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, type FamilyLink } from '../lib/api'
import { useI18n } from '../lib/i18n'
import { useCall } from '../pages/call/CallController'
import { Avatar, Card, useToast } from './ui'
import { IconPin, IconPhone, IconChat } from './icons'

/// "未在共享的联系人"列表（Locations 页用；独立文件不碰 Leaflet，可在 jsdom 单测）：
/// 已接受联系人里此刻**没有**共享位置者，各带"请求共享"按钮——家人打电话没人接开始担心时，
/// 一键发一声请求；对方收到可操作通知后自行决定是否开启（绝非远程强开）。
/// 服务端语义：alreadySharing=对方其实已在共享（列表数据略旧）；deduped=5 分钟内已请求过，不再打扰。
export function RequestShareList({ sharingIds }: { sharingIds: Set<string> }) {
  const { t } = useI18n()
  const toast = useToast()
  const { startOutgoing, active } = useCall() // 就地呼叫未共享的联系人（担心时先打电话，比只能"请求共享"更直接）
  const navigate = useNavigate()
  const [links, setLinks] = useState<FamilyLink[] | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [requestedIds, setRequestedIds] = useState<Set<string>>(new Set()) // 本会话内已请求（按钮变"已请求"防连点）

  useEffect(() => { void api.familyLinks().then((r) => setLinks(r.links)).catch(() => setLinks([])) }, [])

  const request = async (l: FamilyLink) => {
    setBusyId(l.memberId)
    try {
      const r = await api.requestLocation(l.memberId)
      setRequestedIds((prev) => new Set(prev).add(l.memberId))
      if (r.alreadySharing) toast(t(`${l.memberName} 已在共享位置，稍等地图刷新`, `${l.memberName} is already sharing — the map will refresh shortly`), 'info')
      else if (r.deduped) toast(t('刚请求过了，请稍后再试', 'Already requested — try again in a few minutes'), 'info')
      else toast(t(`已请求 ${l.memberName} 共享位置，对方同意后会出现在地图上`, `Asked ${l.memberName} to share — they'll appear on the map if they accept`), 'ok')
    } catch { toast(t('请求失败，请重试', 'Request failed — try again'), 'error') }
    finally { setBusyId(null) }
  }

  const idle = (links ?? []).filter((l) => (l.status ?? 'accepted') === 'accepted' && !sharingIds.has(l.memberId))
  if (links === null || idle.length === 0) return null // 无未共享联系人（或都在共享/加载中）：不渲染空卡
  return (
    <Card className="overflow-hidden">
      <div className="border-b border-[var(--line)] px-4 py-3 text-sm font-semibold">{t('未在共享的联系人', 'Contacts not sharing')}</div>
      <ul className="divide-y divide-[var(--line)]">
        {idle.map((l) => (
          <li key={l.id} className="flex items-center gap-3 px-4 py-3">
            <Avatar name={l.memberName} src={l.memberAvatar} size={38} />
            <div className="min-w-0 flex-1">
              <div className="truncate font-medium">{l.memberName}</div>
              {/* 在线态（与亲友页同口径）：担心对方时的分诊信号——在线（App 开着，没共享大概率没事/可立即接请求）
                  vs 离线（呼叫/电话更直接）。familyLinks 本就带 online，此前这里没呈现。 */}
              <div className="text-xs">
                {l.online && (
                  <span className="mr-1 inline-flex items-center gap-1 font-medium text-ok">
                    <span className="h-1.5 w-1.5 rounded-full bg-ok" aria-hidden="true" />{t('在线', 'Online')} ·{' '}
                  </span>
                )}
                <span className="text-faint">{l.relation}</span>
              </div>
            </div>
            {/* 担心时先直接联系（呼叫/发消息），而非只能"请求共享"干等——与共享中联系人行(SharingContactRow)对齐，
                让位置页成为完整的"看得到 + 联系得上"枢纽。呼叫通话中禁用防并发；三动作互不嵌套(合法 a11y)。 */}
            <button type="button" onClick={() => { if (!active) void startOutgoing(l.memberId, l.memberName, l.memberAvatar) }} disabled={!!active}
              aria-label={t(`呼叫 ${l.memberName}`, `Call ${l.memberName}`)}
              className="shrink-0 rounded-full p-2 text-accent transition hover:surface-2 disabled:cursor-not-allowed disabled:opacity-40">
              <IconPhone width={16} height={16} />
            </button>
            <button type="button" onClick={() => navigate(`/chat/${encodeURIComponent(l.memberId)}`)}
              aria-label={t(`给 ${l.memberName} 发消息`, `Message ${l.memberName}`)}
              className="shrink-0 rounded-full p-2 text-accent transition hover:surface-2">
              <IconChat width={16} height={16} />
            </button>
            <button type="button" onClick={() => void request(l)} disabled={busyId === l.memberId || requestedIds.has(l.memberId)}
              className="inline-flex shrink-0 items-center gap-1 rounded-lg surface-2 px-2.5 py-1.5 text-xs font-medium text-accent transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-50"
              aria-label={t(`请求 ${l.memberName} 共享位置`, `Ask ${l.memberName} to share location`)}>
              <IconPin width={13} height={13} />{requestedIds.has(l.memberId) ? t('已请求', 'Requested') : t('请求共享', 'Ask to share')}
            </button>
          </li>
        ))}
      </ul>
    </Card>
  )
}
