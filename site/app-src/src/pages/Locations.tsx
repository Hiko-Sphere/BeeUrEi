import { useCallback, useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { api, APIError, type ContactLocation } from '../lib/api'
import { pollWhileVisible } from '../lib/poll'
import { batteryBadge, batteryPercent } from '../lib/battery'
import { validAccuracyMeters, accuracyText } from '../lib/geoAccuracy'
import { headingPhrase } from '../lib/heading'
import { appleMapsUrl } from '../lib/location'
import { useI18n } from '../lib/i18n'
import { useSession } from '../lib/session'
import { roleLabel } from '../components/Layout'
import { Card, Avatar, Button, Pill, EmptyState, useToast, timeAgo } from '../components/ui'
import { IconPin } from '../components/icons'

const POLL_MS = 8000      // 拉取联系人位置的间隔
const PUBLISH_MS = 8000   // 共享时上报自身位置的间隔（受服务端 40/min 限流约束）

// 头像式地图标记（DivIcon，纯 HTML——不依赖 Leaflet 默认图标资源，CSP 干净）。
function markerHtml(name: string, color: string): string {
  const initial = ([...(name || '?').trim()][0] ?? '?').toUpperCase() // 按码点取首字符，避免 emoji/增补平面字截出半个代理对
  // 单码点插入 HTML：即便日后改成放全名也不成注入面（对每个插入 HTML 的值一律 escapeHtml，见复审潜在坑）。
  return `<div style="transform:translate(-50%,-100%);">
    <div style="width:34px;height:34px;border-radius:50% 50% 50% 0;background:${color};transform:rotate(-45deg);box-shadow:0 2px 6px rgba(0,0,0,.35);display:grid;place-items:center;">
      <span style="transform:rotate(45deg);color:#14161f;font-weight:700;font-size:14px;font-family:system-ui;">${escapeHtml(initial)}</span>
    </div></div>`
}
const divIcon = (name: string, color: string) =>
  L.divIcon({ html: markerHtml(name, color), className: '', iconSize: [34, 34], iconAnchor: [0, 0] })

export function LocationsPage() {
  const { t, lang } = useI18n()
  const { user } = useSession()
  const toast = useToast()
  const mapEl = useRef<HTMLDivElement>(null)
  const map = useRef<L.Map | null>(null)
  const markers = useRef<Map<string, L.Marker>>(new Map())
  const accuracyCircles = useRef<Map<string, L.Circle>>(new Map()) // 每个联系人的 GPS 精度圈（Find My 式，让协助者看清位置有多准）
  const selfMarker = useRef<L.Marker | null>(null)
  const watchId = useRef<number | null>(null)
  const lastPos = useRef<GeolocationCoordinates | null>(null)
  const publishTimer = useRef<ReturnType<typeof setInterval> | null>(null)
  const fitted = useRef(false)
  const activeRef = useRef(false) // 同步标记"正在共享"：停止后绝不让滞后的 publish 复活共享（见复审）
  // 浏览器 Battery Status API 的 BatteryManager（Chromium 支持；Firefox/Safari 已移除→保持 null 不上报电量）。
  // getBattery() 只需取一次：返回的对象 .level 会随电量实时更新，每次 publish 直接读当前值。
  const batteryMgr = useRef<{ level: number } | null>(null)

  const [contacts, setContacts] = useState<ContactLocation[]>([])
  const [sharing, setSharing] = useState(false)
  const [sharingUntil, setSharingUntil] = useState(0)
  const [featureOff, setFeatureOff] = useState(false)

  // 初始化地图（一次）。
  useEffect(() => {
    if (!mapEl.current || map.current) return
    const m = L.map(mapEl.current, { zoomControl: true, attributionControl: true }).setView([35, 105], 3)
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      // OSM 瓦片使用政策要求归属可见且链接到 copyright 页（Leaflet 归属控件渲染 HTML）。
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors',
    }).addTo(m)
    map.current = m
    // 卸载：Leaflet 自行移除所有图层；组件 ref 随之释放，无需手动清 Map。
    return () => { m.remove(); map.current = null }
  }, [])

  // 轮询联系人位置 + 自身共享状态。
  const poll = useCallback(async () => {
    try {
      const r = await api.contactLocations()
      setContacts(r.contacts)
      setSharing(r.sharing)
      setSharingUntil(r.sharingUntil)
      setFeatureOff(false)
    } catch (e) {
      if (e instanceof APIError && e.status === 403) setFeatureOff(true)
    }
  }, [])
  useEffect(() => { void poll(); return pollWhileVisible(poll, POLL_MS) }, [poll])

  // 把联系人位置同步到地图标记。
  useEffect(() => {
    const m = map.current
    if (!m) return
    const seen = new Set<string>()
    for (const c of contacts) {
      seen.add(c.userId)
      const ll: L.LatLngExpression = [c.lat, c.lng]
      let mk = markers.current.get(c.userId)
      if (!mk) {
        mk = L.marker(ll, { icon: divIcon(c.displayName, '#ffce5c') }).addTo(m)
        markers.current.set(c.userId, mk)
      } else {
        mk.setLatLng(ll)
      }
      // GPS 精度圈（Find My/Google Maps 式）：位置有多准，协助者一眼看清——大圈="在这一带"、小圈=精确。
      // 只在精度有效(有限、正值)时画；interactive:false 让点击穿透到标记。半径=米。
      const acc = validAccuracyMeters(c.accuracy)
      let circle = accuracyCircles.current.get(c.userId)
      if (acc != null) {
        if (!circle) {
          circle = L.circle(ll, { radius: acc, color: '#ffce5c', weight: 1, fillColor: '#ffce5c', fillOpacity: 0.12, interactive: false }).addTo(m)
          accuracyCircles.current.set(c.userId, circle)
        } else { circle.setLatLng(ll); circle.setRadius(acc) }
      } else if (circle) { m.removeLayer(circle); accuracyCircles.current.delete(c.userId) } // 本次无精度：撤掉旧圈
      // danger 用 text-danger 类（项目无 --danger 变量；类还自带暗色主题对比度覆盖 .dark .text-danger）。
      const batt = batteryBadge(c.battery, lang)
      // critical(≤10%即将关机)加 ⚠️ 前缀，协助者盯多个联系人时一眼分清最危急的（读屏也念"警告"）。
      const battHtml = batt ? ` · <span class="${batt.danger ? 'text-danger font-semibold' : ''}">${batt.critical ? '⚠️ ' : ''}${escapeHtml(batt.text)}</span>` : ''
      // 精度文字（协助者读屏/看不清圈时也知道有多准）："精确到约 20 米"。
      const accLabel = accuracyText(c.accuracy, t)
      const accHtml = accLabel ? ` · ${escapeHtml(accLabel)}` : ''
      // 行进方向（服务端一直下发 heading、web 却从未呈现——死字段）：协助者据此判断对方是否正朝约定地点移动
      // （Find My/Google 式方向指示，用**文字**兼顾读屏与看不清地图者）。heading 仅移动时有效，静止/不可用→null 不显。
      const headPhrase = headingPhrase(c.heading, lang)
      const headHtml = headPhrase ? ` · ${escapeHtml(headPhrase)}` : ''
      // 「在地图中打开」：协助者要去找/接盲人时，一键在自己的地图 App 里导航到其位置（Apple Maps，境内可开+WGS-84 纠偏）。
      const mapsUrl = appleMapsUrl(c.lat, c.lng, c.displayName)
      const openHtml = `<br><a href="${mapsUrl}" target="_blank" rel="noreferrer" class="underline">${escapeHtml(t('在地图中打开', 'Open in Maps'))}</a>`
      mk.bindPopup(`<b>${escapeHtml(c.displayName)}</b><br>${roleLabel(c.role, t)} · ${timeAgo(c.updatedAt, lang)}${battHtml}${accHtml}${headHtml}${openHtml}`)
    }
    // 移除已不再共享的联系人标记 + 其精度圈。
    for (const [id, mk] of markers.current) if (!seen.has(id)) { m.removeLayer(mk); markers.current.delete(id) }
    for (const [id, cir] of accuracyCircles.current) if (!seen.has(id)) { m.removeLayer(cir); accuracyCircles.current.delete(id) }
    // 首次有数据时自适应视野。
    if (!fitted.current) {
      const pts: L.LatLngExpression[] = contacts.map((c) => [c.lat, c.lng])
      if (lastPos.current) pts.push([lastPos.current.latitude, lastPos.current.longitude])
      if (pts.length === 1) { m.setView(pts[0], 16); fitted.current = true }
      else if (pts.length > 1) { m.fitBounds(L.latLngBounds(pts).pad(0.3)); fitted.current = true }
    }
  }, [contacts, t, lang])

  const publish = useCallback(async () => {
    if (!activeRef.current) return // 已停止：不再上报（防滞后调用复活共享）
    const p = lastPos.current
    if (!p) return
    try {
      const r = await api.updateLocation({ lat: p.latitude, lng: p.longitude, accuracy: p.accuracy ?? undefined,
        heading: (p.heading != null && !Number.isNaN(p.heading)) ? p.heading : undefined,
        // 上报本机电量（Find My/Life360 惯例）：亲友看到"快没电"可在失联前主动联系；也让服务端低电量预警对 web 共享者生效。
        // 此前 web 从不上报电量（只上报了 accuracy/heading），web 共享者的联系人永远看到"无电量"、低电量预警也不触发。
        battery: batteryPercent(batteryMgr.current?.level) })
      if (!activeRef.current) return // await 期间用户已停止：不要把状态改回"共享中"
      setSharing(true); setSharingUntil(r.sharingUntil)
    } catch { /* 单次失败忽略，下个周期重试 */ }
  }, [])

  const stopSharing = useCallback(() => {
    activeRef.current = false // 同步置否：任何在途/后续 publish 立即变为 no-op
    lastPos.current = null // 清陈旧坐标：否则**再次**共享时的即时 publish() 会把上一段行程的旧位置当"当前实时"广播给亲友（隐私，复审 HIGH）——清空后靠 `if(!p)return` 兜到新定位到达
    if (watchId.current != null) { navigator.geolocation.clearWatch(watchId.current); watchId.current = null }
    if (publishTimer.current) { clearInterval(publishTimer.current); publishTimer.current = null }
    void api.stopSharingLocation().catch(() => {})
    setSharing(false); setSharingUntil(0)
    if (selfMarker.current && map.current) { map.current.removeLayer(selfMarker.current); selfMarker.current = null }
  }, [])

  // 功能被管理员中途停用（/contacts 返回 403）：立即拆除采集与上报，避免持续 403 刷请求。
  useEffect(() => { if (featureOff) stopSharing() }, [featureOff, stopSharing])

  const startSharing = useCallback(() => {
    if (!('geolocation' in navigator)) { toast(t('当前浏览器不支持定位', 'Geolocation not supported'), 'error'); return }
    activeRef.current = true
    // 取一次 BatteryManager（Chromium 有；其它浏览器无 getBattery→保持 null，publish 时 batteryPercent(undefined) 不上报）。
    const nav = navigator as Navigator & { getBattery?: () => Promise<{ level: number }> }
    if (nav.getBattery && !batteryMgr.current) { void nav.getBattery().then((b) => { batteryMgr.current = b }).catch(() => { /* 取不到就不报电量 */ }) }
    watchId.current = navigator.geolocation.watchPosition(
      (pos) => {
        lastPos.current = pos.coords
        // 自身标记。
        const m = map.current
        if (m) {
          const ll: L.LatLngExpression = [pos.coords.latitude, pos.coords.longitude]
          if (!selfMarker.current) { selfMarker.current = L.marker(ll, { icon: divIcon(user?.displayName || t('我', 'Me'), '#f2a900') }).addTo(m).bindPopup(t('我的位置', 'My location')) ; if (!fitted.current) { m.setView(ll, 16); fitted.current = true } }
          else selfMarker.current.setLatLng(ll)
        }
      },
      (err) => { toast(err.code === err.PERMISSION_DENIED ? t('定位权限被拒绝', 'Location permission denied') : t('无法获取位置', 'Cannot get location'), 'error'); stopSharing() },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 20000 },
    )
    void publish()
    publishTimer.current = setInterval(() => void publish(), PUBLISH_MS)
    setSharing(true)
    toast(t('已开始共享位置', 'Started sharing your location'), 'ok')
  }, [publish, t, toast, user, stopSharing])

  // 卸载时停止本地采集（不主动停服务端共享：用户可能切页继续共享——但定时器须清，避免泄漏）。
  useEffect(() => () => {
    activeRef.current = false
    lastPos.current = null // 同 stopSharing：卸载清陈旧坐标，防重挂后即时 publish 广播旧位置
    if (watchId.current != null) navigator.geolocation.clearWatch(watchId.current)
    if (publishTimer.current) clearInterval(publishTimer.current)
  }, [])

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('实时位置', 'Live location')}</h1>
        <p className="mt-1 text-sm text-faint">{t('与你的联系人互相共享当前位置。仅你已绑定的亲友/协助者可见，停止后立即不可见。', 'Share your live location with your contacts. Only your linked contacts can see it; stops instantly when you turn it off.')}</p>
      </div>

      {featureOff ? (
        <Card><EmptyState icon={<IconPin />} title={t('位置共享已关闭', 'Location sharing is off')} message={t('管理员已停用该功能', 'Disabled by the administrator')} /></Card>
      ) : (
        <>
          {/* 共享开关 */}
          <Card className="flex flex-wrap items-center justify-between gap-3 p-4">
            <div className="flex items-center gap-3">
              <span className={`flex h-10 w-10 items-center justify-center rounded-full ${sharing ? 'bg-ok/15 text-ok' : 'bg-honey/15 text-honey'}`}><IconPin /></span>
              <div>
                <div className="font-semibold">{sharing ? t('正在共享你的位置', 'Sharing your location') : t('未共享', 'Not sharing')}</div>
                <div className="text-xs text-faint">{sharing && sharingUntil > Date.now() ? t(`将持续到 ${new Date(sharingUntil).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`, `Until ${new Date(sharingUntil).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}`) : t('开启后联系人可看到你的实时位置', 'Contacts will see your live position')}</div>
              </div>
            </div>
            {sharing
              ? <Button variant="danger" onClick={stopSharing}>{t('停止共享', 'Stop sharing')}</Button>
              : <Button onClick={startSharing}><IconPin width={16} height={16} />{t('开始共享', 'Share my location')}</Button>}
          </Card>

          {/* 地图 */}
          <Card className="overflow-hidden p-0">
            <div ref={mapEl} className="h-[60vh] min-h-[360px] w-full" style={{ background: 'var(--surface-2)' }} />
          </Card>

          {/* 正在共享的联系人列表 */}
          <Card className="overflow-hidden">
            <div className="flex items-center gap-2 border-b border-[var(--line)] px-4 py-3"><span className="text-sm font-semibold">{t('正在共享的联系人', 'Contacts sharing now')}</span><Pill tone={contacts.length ? 'honey' : 'soft'}>{contacts.length}</Pill></div>
            {contacts.length === 0 ? (
              <EmptyState icon={<IconPin />} title={t('暂无联系人在共享位置', 'No contacts sharing')} message={t('当联系人开启共享时，会显示在地图与此处', 'They appear here and on the map when sharing')} />
            ) : (
              <ul className="divide-y divide-[var(--line)]">
                {contacts.map((c) => (
                  <li key={c.userId}>
                    {/* 行内容包 <button>：<li> 保留 listitem，按钮可键盘聚焦/激活（Enter 平移地图到该联系人）。 */}
                    <button type="button" onClick={() => { const mk = markers.current.get(c.userId); if (mk && map.current) { map.current.setView(mk.getLatLng(), 16); mk.openPopup() } }}
                      className="flex w-full items-center gap-3 px-4 py-3 text-left hover:surface-2">
                      <Avatar name={c.displayName} src={c.avatar} size={38} />
                      <div className="min-w-0 flex-1">
                        <div className="truncate font-medium">{c.displayName}</div>
                        <div className="text-xs text-faint">
                          {roleLabel(c.role, t)} · {t('更新于', 'updated')} {timeAgo(c.updatedAt, lang)}
                          {(() => { const b = batteryBadge(c.battery, lang); return b ? <> · <span className={b.danger ? 'font-semibold text-danger' : ''}>{b.critical ? '⚠️ ' : ''}{b.text}</span></> : null })()}
                        </div>
                      </div>
                      <span className="inline-block h-2 w-2 rounded-full bg-ok ring-live" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </>
      )}
    </div>
  )
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))
}
