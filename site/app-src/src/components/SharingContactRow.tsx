import type { ContactLocation } from '../lib/api'
import { Avatar, RelativeTime } from './ui'
import { batteryBadge } from '../lib/battery'
import { roleLabel } from './Layout'
import { IconPhone, IconChat } from './icons'

/// 「正在共享位置的联系人」行（Locations 页用；独立文件不碰 Leaflet，可 jsdom 单测）。
/// 除"在地图上定位"外，补**呼叫 / 发消息**直达——低电量告警把家人引到位置页说"趁没关机联系他"，此前这里
/// 只能看位置、无从联系，得再切去亲友/聊天页；现可就地呼叫或发消息。定位/呼叫/消息三动作互不嵌套（合法 a11y）。
export function SharingContactRow({ c, lang, t, callDisabled, onLocate, onCall, onMessage }: {
  c: ContactLocation
  lang: 'zh' | 'en'
  t: (zh: string, en: string) => string
  callDisabled?: boolean // 已在通话中：禁呼叫（避免并发呼叫）
  onLocate: () => void
  onCall: () => void
  onMessage: () => void
}) {
  const b = batteryBadge(c.battery, lang)
  return (
    <li className="flex items-center gap-2 px-4 py-3 hover:surface-2">
      {/* 定位：点信息区在地图上平移到该联系人（Enter 可激活）。 */}
      <button type="button" onClick={onLocate} className="flex min-w-0 flex-1 items-center gap-3 text-left"
        aria-label={t(`在地图上定位 ${c.displayName}`, `Locate ${c.displayName} on the map`)}>
        <Avatar name={c.displayName} src={c.avatar} size={38} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{c.displayName}</div>
          <div className="text-xs text-faint">
            {roleLabel(c.role, t)} · {t('更新于', 'updated')} <RelativeTime ms={c.updatedAt} lang={lang} />
            {b ? <> · <span className={b.danger ? 'font-semibold text-danger' : ''}>{b.critical ? '⚠️ ' : ''}{b.text}</span></> : null}
          </div>
        </div>
      </button>
      <span className="inline-block h-2 w-2 shrink-0 rounded-full bg-ok ring-live" aria-hidden />
      {/* 呼叫（通话中禁，避免并发）＋ 发消息：把家人引到位置页的低电量告警"趁没关机联系他"就地可达。 */}
      <button type="button" onClick={onCall} disabled={callDisabled}
        aria-label={t(`呼叫 ${c.displayName}`, `Call ${c.displayName}`)}
        className="shrink-0 rounded-full p-2 text-accent transition hover:surface-2 disabled:cursor-not-allowed disabled:opacity-40">
        <IconPhone width={18} height={18} />
      </button>
      <button type="button" onClick={onMessage}
        aria-label={t(`给 ${c.displayName} 发消息`, `Message ${c.displayName}`)}
        className="shrink-0 rounded-full p-2 text-accent transition hover:surface-2">
        <IconChat width={18} height={18} />
      </button>
    </li>
  )
}
