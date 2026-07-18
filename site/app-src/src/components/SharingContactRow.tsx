import { useState } from 'react'
import { api, type ContactLocation } from '../lib/api'
import { Avatar, RelativeTime } from './ui'
import { batteryBadge } from '../lib/battery'
import { viewAccuracyNote } from '../lib/geoAccuracy'
import { getUnit } from '../lib/distanceUnit'
import { headingPhrase } from '../lib/heading'
import { roleLabel } from './Layout'
import { IconPhone, IconChat, IconPin, IconZoom } from './icons'
import { appleMapsDirectionsUrl, validLatLng } from '../lib/location'
import { composeContactAddress } from '../lib/contactAddress'

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
  const acc = viewAccuracyNote(c.accuracy, t, getUnit()) // {text,coarse}｜null：粗定位(≥500m)显式标"大致位置"，读屏家人不误信街道级
  const head = headingPhrase(c.heading, lang)  // "正朝东北方向移动"；静止/不可用→null 省略

  // 「查看所在地址」：读屏/低视力家人看不到地图 pin，点一下把对方位置逆地理成文字街道地址（对标 Find My/Google
  // 位置共享给出地址）。**按需**请求（点击才打高德，非随位置刷新反复打）；仅境内有数据，境外/无数据显式告知。
  // addr 记下逆地理时对应的 updatedAt：对方移动后（updatedAt 变了）旧地址即过时、不再显示误导性旧位置（下方 freshAddr 门控）。
  const [addr, setAddr] = useState<{ text: string; at: number } | null>(null)
  const [addrState, setAddrState] = useState<'idle' | 'loading' | 'error'>('idle')
  const freshAddr = addr && addr.at === c.updatedAt ? addr.text : null // 仅当仍对应当前位置才显示
  async function loadAddress() {
    if (addrState === 'loading') return
    setAddrState('loading')
    try {
      const r = await api.contactAddress(c.userId)
      // 组合（AOI ≤300m 距离门 + 路口/地标）走纯函数 composeContactAddress（与 iOS/盲人端「我在哪」同口径、可单测）。
      const text = composeContactAddress(r, t)
      if (!text) { setAddrState('error'); return }
      setAddr({ text, at: c.updatedAt }); setAddrState('idle') // 绑定当前 updatedAt：对方移动后此地址即被 freshAddr 判过时
    } catch { setAddrState('error') } // 404(境外/无数据/未共享)/网络/服务端错误一律显式提示，绝不留空
  }

  return (
    <li className="flex flex-col gap-1.5 px-4 py-3 hover:surface-2"><div className="flex items-center gap-2">
      {/* 定位：点信息区在地图上平移到该联系人（Enter 可激活）。 */}
      <button type="button" onClick={onLocate} className="flex min-w-0 flex-1 items-center gap-3 text-left"
        aria-label={t(`在地图上定位 ${c.displayName}`, `Locate ${c.displayName} on the map`)}>
        <Avatar name={c.displayName} src={c.avatar} size={38} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-medium">{c.displayName}</div>
          <div className="text-xs text-faint">
            {roleLabel(c.role, t)} · {t('更新于', 'updated')} <RelativeTime ms={c.updatedAt} lang={lang} />
            {b ? <> · <span className={b.danger ? 'font-semibold text-danger' : ''}>{b.critical ? '⚠️ ' : ''}{b.text}</span></> : null}
            {acc ? <> · <span className={acc.coarse ? 'font-semibold text-danger' : ''}>{acc.coarse ? '⚠️ ' : ''}{acc.text}</span></> : null}
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
      {/* 查看所在地址：把对方位置逆地理成文字街道地址（读屏/低视力家人看不到 pin 的刚需）。按需请求、可重试。 */}
      <button type="button" onClick={loadAddress} disabled={addrState === 'loading'}
        aria-label={t(`查看 ${c.displayName} 所在地址`, `Show ${c.displayName}'s address`)}
        title={t('查看所在地址', 'Show address')}
        className="shrink-0 rounded-full p-2 text-accent transition hover:surface-2 disabled:opacity-40">
        <IconZoom width={18} height={18} />
      </button>
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
      {/* 一键导航前往对方位置（开系统地图，选驾车/步行）——"在地图上定位"是站内看，这个是**去**。坏坐标不渲染。 */}
      {validLatLng(c.lat, c.lng) && (
        <a href={appleMapsDirectionsUrl(c.lat, c.lng, c.displayName)} target="_blank" rel="noopener noreferrer"
          aria-label={t(`导航前往 ${c.displayName} 的位置`, `Get directions to ${c.displayName}`)}
          title={t('导航前往（在地图中选驾车/步行）', 'Get directions')}
          className="shrink-0 rounded-full p-2 text-accent transition hover:surface-2">
          <IconPin width={18} height={18} />
        </a>
      )}
      </div>
      {/* 地址结果：aria-live 让读屏在加载完成时即时念出地址（安全相关信息）。加载中/失败均显式，绝不留空。
          用 freshAddr（仅当仍对应当前位置）——对方移动后旧地址隐藏、不误导（家人可再点取新地址）。 */}
      {(freshAddr || addrState !== 'idle') && (
        <div aria-live="polite" className="pl-[50px] text-xs text-faint">
          {addrState === 'loading'
            ? t('正在获取地址…', 'Getting address…')
            : addrState === 'error'
              ? <span className="text-danger">{t('暂时无法获取地址（可能在境外或无数据）', "Address unavailable (may be overseas or no data)")}</span>
              : freshAddr && <>📍 {freshAddr}</>}
        </div>
      )}
    </li>
  )
}
