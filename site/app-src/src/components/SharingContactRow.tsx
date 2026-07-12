import type { ContactLocation } from '../lib/api'
import { Avatar, RelativeTime } from './ui'
import { batteryBadge } from '../lib/battery'
import { accuracyText } from '../lib/geoAccuracy'
import { headingPhrase } from '../lib/heading'
import { roleLabel } from './Layout'
import { IconPhone, IconChat } from './icons'

/// 「正在共享位置的联系人」行（Locations 页用；独立文件不碰 Leaflet，可 jsdom 单测）。
/// 除"在地图上定位"外，补**呼叫 / 发消息**直达——低电量告警把家人引到位置页说"趁没关机联系他"，此前这里
/// 只能看位置、无从联系，得再切去亲友/聊天页；现可就地呼叫或发消息。定位/呼叫/消息三动作互不嵌套（合法 a11y）。
///
/// 精度（accuracyText）与行进方向（headingPhrase）此前只画在 Leaflet 地图气泡里——读屏家人（本身可能也有障碍）
/// 用不了视觉地图，看不到"位置有多准/对方朝哪走"这两条安全相关信息。这里把地图气泡同款文字补进**无障碍列表行**，
/// 与气泡口径一致（同 helper、null 即省略）：粗定位不误信街道级、能判断对方是否正朝约定地点移动。
export function SharingContactRow({ c, lang, t, live, callDisabled, onLocate, onCall, onMessage }: {
  c: ContactLocation
  lang: 'zh' | 'en'
  t: (zh: string, en: string) => string
  live: boolean // 位置是否仍在活跃更新（见 isLocationLive）：false=共享中但近期无新位置，圆点不脉动、不冒充实时
  callDisabled?: boolean // 已在通话中：禁呼叫（避免并发呼叫）
  onLocate: () => void
  onCall: () => void
  onMessage: () => void
}) {
  const b = batteryBadge(c.battery, lang)
  const acc = accuracyText(c.accuracy, t)      // "精确到约 20 米"；无效精度→null 省略
  const head = headingPhrase(c.heading, lang)  // "正朝东北方向移动"；静止/不可用→null 省略
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
            {acc ? <> · {acc}</> : null}
            {head ? <> · {head}</> : null}
          </div>
        </div>
      </button>
      {/* 实时状态圆点：仅在位置确在活跃更新时脉动绿点（live）；若共享中但近期无新位置（对方可能关页/断网/没电），
          改为静态弱色点、不脉动——避免"假实时"绿点误导担心的家人（相对时间"更新于 X 前"另已如实显示时长）。
          data-live 供测试断言状态；title 给弱色点悬停释义。 */}
      {live
        ? <span data-testid="live-dot" data-live="1" className="inline-block h-2 w-2 shrink-0 rounded-full bg-ok ring-live" aria-hidden />
        : <span data-testid="live-dot" data-live="0" title={t('共享中，暂无最新位置', 'Sharing, no recent update')}
            className="inline-block h-2 w-2 shrink-0 rounded-full bg-[var(--text-faint)]" aria-hidden />}
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
