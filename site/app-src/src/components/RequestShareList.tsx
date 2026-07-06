import { useEffect, useState } from 'react'
import { api, type FamilyLink } from '../lib/api'
import { useI18n } from '../lib/i18n'
import { Avatar, Card, useToast } from './ui'
import { IconPin } from './icons'

/// "未在共享的联系人"列表（Locations 页用；独立文件不碰 Leaflet，可在 jsdom 单测）：
/// 已接受联系人里此刻**没有**共享位置者，各带"请求共享"按钮——家人打电话没人接开始担心时，
/// 一键发一声请求；对方收到可操作通知后自行决定是否开启（绝非远程强开）。
/// 服务端语义：alreadySharing=对方其实已在共享（列表数据略旧）；deduped=5 分钟内已请求过，不再打扰。
export function RequestShareList({ sharingIds }: { sharingIds: Set<string> }) {
  const { t } = useI18n()
  const toast = useToast()
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
              <div className="text-xs text-faint">{l.relation}</div>
            </div>
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
