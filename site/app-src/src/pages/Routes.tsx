import { useCallback, useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { api, APIError, contentBlockedText, type SavedRouteInfo, type RouteWaypoint, type FamilyLink } from '../lib/api'
import { routeDistanceMeters, routeDistanceText, routeWalkingText } from '../lib/location'
import { getUnit } from '../lib/distanceUnit'
import { useI18n } from '../lib/i18n'
import { useSession } from '../lib/session'
import { Card, Button, EmptyState, useToast, Modal } from '../components/ui'
import { IconPin } from '../components/icons'

// 与服务端 savedRoutes.ts 同口径的客户端约束（免得画完才被拒）。
const MAX_WAYPOINTS = 200
const NAME_MAX = 40
const NOTE_MAX = 60

// 航点序号标记（DivIcon 纯 HTML，无外部图标资源，CSP 干净；序号是受控数字非用户输入，无注入面）。
function wpIcon(n: number, selected: boolean): L.DivIcon {
  return L.divIcon({
    html: `<div style="transform:translate(-50%,-50%);width:26px;height:26px;border-radius:50%;
      background:${selected ? '#e5484d' : '#f2a900'};color:#14161f;display:grid;place-items:center;
      font:700 13px system-ui;box-shadow:0 1px 4px rgba(0,0,0,.4);border:2px solid #fff;">${n}</div>`,
    className: '', iconSize: [26, 26], iconAnchor: [0, 0],
  })
}

/// 亲友路线编辑器（Soundscape Guided Routes 式）：在 OSM 地图上替互链盲人（或自己）踩点画路线，
/// 盲人端沿信标执行。坐标全程 WGS-84——**瓦片必须 OSM**，换 amap 瓦片（GCJ-02）会让存储坐标系统性偏移。
export function RoutesPage() {
  const { t } = useI18n()
  const { user } = useSession()
  const toast = useToast()
  const [routes, setRoutes] = useState<SavedRouteInfo[]>([])
  const [contacts, setContacts] = useState<FamilyLink[]>([])
  const [loading, setLoading] = useState(true)

  // 编辑态（null=列表态）
  const [editing, setEditing] = useState<{ id?: string; forUserId: string; name: string; waypoints: RouteWaypoint[] } | null>(null)
  const [selectedIdx, setSelectedIdx] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState<SavedRouteInfo | null>(null)

  const mapEl = useRef<HTMLDivElement>(null)
  const mapRef = useRef<L.Map | null>(null)
  const layerRef = useRef<L.LayerGroup | null>(null)
  const editingRef = useRef(editing)
  editingRef.current = editing

  const reload = useCallback(async () => {
    try {
      const [r, l] = await Promise.all([api.listRoutes(), api.familyLinks()])
      setRoutes(r.routes)
      setContacts(l.links.filter((x) => (x.status ?? 'accepted') === 'accepted' && !x.outgoing))
    } catch { toast(t('加载失败', 'Failed to load'), 'error') }
    finally { setLoading(false) }
  }, [t, toast])
  useEffect(() => { void reload() }, [reload])

  // 进入编辑态时挂地图（OSM 瓦片=WGS-84，与服务端存储一致；绝不可换 GCJ-02 瓦片源）。
  useEffect(() => {
    if (!editing || !mapEl.current || mapRef.current) return
    const map = L.map(mapEl.current, { zoomControl: true })
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      // OSM 瓦片使用政策要求归属可见且链接到 copyright 页（Leaflet 归属控件渲染 HTML）。
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors', maxZoom: 19,
    }).addTo(map)
    const first = editing.waypoints[0]
    map.setView(first ? [first.lat, first.lng] : [31.2304, 121.4737], first ? 17 : 12)
    map.on('click', (e: L.LeafletMouseEvent) => {
      const cur = editingRef.current
      if (!cur) return
      if (cur.waypoints.length >= MAX_WAYPOINTS) { toast(t(`最多 ${MAX_WAYPOINTS} 个路线点`, `Max ${MAX_WAYPOINTS} points`), 'error'); return }
      setEditing({ ...cur, waypoints: [...cur.waypoints, { lat: e.latlng.lat, lng: e.latlng.lng }] })
      setSelectedIdx(cur.waypoints.length)
    })
    layerRef.current = L.layerGroup().addTo(map)
    mapRef.current = map
    return () => { map.remove(); mapRef.current = null; layerRef.current = null }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [!!editing])

  // 航点/选中变化 → 重绘标记与折线。
  useEffect(() => {
    const layer = layerRef.current
    if (!layer || !editing) return
    layer.clearLayers()
    editing.waypoints.forEach((w, i) => {
      L.marker([w.lat, w.lng], { icon: wpIcon(i + 1, i === selectedIdx) })
        .on('click', () => setSelectedIdx(i))
        .addTo(layer)
    })
    if (editing.waypoints.length >= 2) {
      L.polyline(editing.waypoints.map((w) => [w.lat, w.lng]), { color: '#f2a900', weight: 4, opacity: 0.85 }).addTo(layer)
    }
  }, [editing, selectedIdx])

  const startNew = () => { setEditing({ forUserId: user?.id ?? '', name: '', waypoints: [] }); setSelectedIdx(null) }
  const startEdit = (r: SavedRouteInfo) => {
    setEditing({ id: r.id, forUserId: r.ownerId, name: r.name, waypoints: r.waypoints })
    setSelectedIdx(null)
  }
  const closeEditor = () => { setEditing(null); setSelectedIdx(null) }
  // 上移(-1)/下移(+1)一个航点：交换相邻两点，选中态跟随移动的点。
  const moveWaypoint = (i: number, dir: -1 | 1) => {
    if (!editing) return
    const j = i + dir
    if (j < 0 || j >= editing.waypoints.length) return
    const next = [...editing.waypoints]
    ;[next[i], next[j]] = [next[j], next[i]]
    setEditing({ ...editing, waypoints: next })
    setSelectedIdx(j)
  }

  const save = async () => {
    if (!editing || busy) return
    const name = editing.name.trim()
    if (!name) { toast(t('请填写路线名称', 'Please name the route'), 'error'); return }
    if (editing.waypoints.length < 2) { toast(t('至少需要 2 个路线点', 'At least 2 points required'), 'error'); return }
    setBusy(true)
    try {
      if (editing.id) await api.updateRoute(editing.id, { name, waypoints: editing.waypoints })
      else await api.createRoute(name, editing.waypoints, editing.forUserId === user?.id ? undefined : editing.forUserId)
      toast(t('路线已保存', 'Route saved'), 'ok')
      closeEditor()
      await reload()
    } catch (e) {
      const msg = e instanceof APIError && e.code === 'route_limit' ? t('对方的路线数已达上限', 'Route limit reached for this person')
        : e instanceof APIError && e.code === 'not_linked' ? t('你们尚未建立联系', 'You are not linked')
        : contentBlockedText(e, t, t('保存失败', 'Failed to save'))
      toast(msg, 'error')
    } finally { setBusy(false) }
  }

  const doDelete = async (r: SavedRouteInfo) => {
    setConfirmDelete(null)
    try { await api.deleteRoute(r.id); toast(t('已删除', 'Deleted'), 'ok'); await reload() }
    catch { toast(t('删除失败', 'Failed to delete'), 'error') }
  }

  const ownerName = (r: SavedRouteInfo) =>
    r.ownerId === user?.id ? t('我自己', 'Myself') : (contacts.find((c) => c.memberId === r.ownerId)?.memberName ?? t('联系人', 'Contact'))

  // ---------- 编辑态 ----------
  if (editing) {
    const wp = editing.waypoints
    return (
      <div className="space-y-4">
        <Card>
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="text-lg font-semibold">{editing.id ? t('编辑路线', 'Edit route') : t('新建路线', 'New route')}</h2>
            <span className="text-xs text-faint">{t('在地图上点击依次添加路线点（步行顺序）', 'Click the map to add points in walking order')}</span>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} maxLength={NAME_MAX}
              placeholder={t('路线名称（如：家到菜场）', 'Route name (e.g. Home to market)')} aria-label={t('路线名称', 'Route name')}
              className="w-56 rounded-xl border border-[var(--line)] surface-2 px-3 py-2 text-sm outline-none focus:border-honey" />
            {!editing.id && (
              <select value={editing.forUserId} onChange={(e) => setEditing({ ...editing, forUserId: e.target.value })}
                aria-label={t('路线给谁用', 'Route for whom')}
                className="rounded-xl border border-[var(--line)] surface-2 px-3 py-2 text-sm outline-none">
                <option value={user?.id ?? ''}>{t('给我自己', 'For myself')}</option>
                {contacts.map((c) => <option key={c.memberId} value={c.memberId}>{t(`给 ${c.memberName}`, `For ${c.memberName}`)}</option>)}
              </select>
            )}
            <span className="text-xs text-faint">
              {t(`${wp.length} 个点`, `${wp.length} points`)}
              {wp.length >= 2 && ` · ${routeDistanceText(routeDistanceMeters(wp), t, getUnit())} · ${routeWalkingText(routeDistanceMeters(wp), t)}`}
            </span>
            <div className="ml-auto flex gap-2">
              <Button variant="soft" onClick={() => { if (wp.length) { setEditing({ ...editing, waypoints: wp.slice(0, -1) }); setSelectedIdx(null) } }} disabled={!wp.length}>
                {t('撤销最后一点', 'Undo last')}
              </Button>
              <Button variant="ghost" onClick={closeEditor}>{t('取消', 'Cancel')}</Button>
              <Button variant="primary" loading={busy} onClick={() => void save()} disabled={wp.length < 2 || !editing.name.trim()}>
                {t('保存路线', 'Save route')}
              </Button>
            </div>
          </div>
        </Card>
        <div ref={mapEl} className="h-[52vh] w-full overflow-hidden rounded-2xl border border-[var(--line)]" aria-label={t('路线编辑地图', 'Route editing map')} />
        {/* 航点列表：地图之外的等效编辑通道（备注/删除），也是键盘路径 */}
        <Card>
          <h3 className="text-sm font-semibold">{t('路线点', 'Waypoints')}</h3>
          {wp.length === 0 && <p className="mt-2 text-sm text-faint">{t('点击地图添加第一个点（起点）', 'Click the map to add the first point (start)')}</p>}
          <ol className="mt-2 space-y-1.5">
            {wp.map((w, i) => (
              <li key={i} className={`flex flex-wrap items-center gap-2 rounded-xl px-2.5 py-1.5 ${i === selectedIdx ? 'bg-honey/15' : ''}`}>
                <button onClick={() => { setSelectedIdx(i); mapRef.current?.panTo([w.lat, w.lng]) }}
                  className="w-7 shrink-0 rounded-full bg-honey/30 py-0.5 text-center text-xs font-bold"
                  aria-label={t(`选中第 ${i + 1} 个路线点`, `Select point ${i + 1}`)}>{i + 1}</button>
                <input value={w.note ?? ''} maxLength={NOTE_MAX}
                  onChange={(e) => {
                    const next = [...wp]; next[i] = { ...w, note: e.target.value || undefined }
                    setEditing({ ...editing, waypoints: next })
                  }}
                  placeholder={t('到点播报（如：过了报亭右转）', 'Spoken note (e.g. turn right after the kiosk)')}
                  aria-label={t(`第 ${i + 1} 点的播报`, `Note for point ${i + 1}`)}
                  className="min-w-0 flex-1 rounded-lg border border-[var(--line)] surface-2 px-2 py-1 text-sm outline-none focus:border-honey" />
                {/* 上移/下移：步行顺序至关重要，画错顺序可就地调，不必删了重画 */}
                <button onClick={() => moveWaypoint(i, -1)} disabled={i === 0}
                  className="rounded px-1.5 text-sm text-soft hover:surface-2 disabled:opacity-30"
                  aria-label={t(`把第 ${i + 1} 个路线点上移`, `Move point ${i + 1} up`)}>↑</button>
                <button onClick={() => moveWaypoint(i, 1)} disabled={i === wp.length - 1}
                  className="rounded px-1.5 text-sm text-soft hover:surface-2 disabled:opacity-30"
                  aria-label={t(`把第 ${i + 1} 个路线点下移`, `Move point ${i + 1} down`)}>↓</button>
                <button onClick={() => {
                  setEditing({ ...editing, waypoints: wp.filter((_, j) => j !== i) }); setSelectedIdx(null)
                }} className="text-xs text-danger hover:underline" aria-label={t(`删除第 ${i + 1} 个路线点`, `Delete point ${i + 1}`)}>
                  {t('删除', 'Delete')}
                </button>
              </li>
            ))}
          </ol>
        </Card>
      </div>
    )
  }

  // ---------- 列表态 ----------
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="text-xl font-bold">{t('路线', 'Routes')}</h1>
        <span className="text-sm text-faint">{t('替视障亲友画好常走路线，对方在 App 里一键沿提示音行走', 'Draw familiar routes for blind contacts — they follow audio beacons in the app')}</span>
        <div className="ml-auto"><Button variant="primary" onClick={startNew}>{t('新建路线', 'New route')}</Button></div>
      </div>
      {loading ? <p className="text-sm text-faint">{t('加载中…', 'Loading…')}</p>
        : routes.length === 0 ? (
          <EmptyState icon={<IconPin width={28} height={28} />} title={t('还没有路线', 'No routes yet')}
            message={t('点「新建路线」，在地图上替亲友踩好第一条常走路线', 'Tap “New route” and draw the first familiar route for a contact')} />
        ) : (
          <div className="grid gap-3 sm:grid-cols-2">
            {routes.map((r) => (
              <Card key={r.id}>
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">{r.name}</div>
                    <div className="mt-0.5 text-xs text-faint">
                      {t(`给${ownerName(r)} · ${r.waypoints.length} 个点`, `For ${ownerName(r)} · ${r.waypoints.length} points`)}
                      {r.waypoints.length >= 2 && ` · ${routeDistanceText(routeDistanceMeters(r.waypoints), t, getUnit())} · ${routeWalkingText(routeDistanceMeters(r.waypoints), t)}`}
                    </div>
                    {/* 信任透明：这条是别人替我画的（role=owner 且有创建者名）→ 显示"由 X 创建"，让要沿它走的人知道路线可信度取决于谁画的
                        （与 iOS 盲人端"这条是谁画的"同口径）。自己画的(createdByName 为空)不赘述。 */}
                    {r.role === 'owner' && r.createdByName && (
                      <div className="mt-0.5 text-xs text-faint">{t(`由 ${r.createdByName} 创建`, `Created by ${r.createdByName}`)}</div>
                    )}
                  </div>
                </div>
                <div className="mt-3 flex gap-2">
                  <Button variant="soft" onClick={() => startEdit(r)}>{t('编辑', 'Edit')}</Button>
                  <Button variant="ghost" onClick={() => setConfirmDelete(r)}>{t('删除', 'Delete')}</Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      {confirmDelete && (
        <Modal onClose={() => setConfirmDelete(null)} label={t('删除路线', 'Delete route')}>
          <h3 className="text-lg font-semibold">{t('删除这条路线？', 'Delete this route?')}</h3>
          <p className="mt-2 text-sm text-soft">{t(`「${confirmDelete.name}」删除后对方将无法再使用它，不可恢复。`, `“${confirmDelete.name}” will no longer be usable and cannot be recovered.`)}</p>
          <div className="mt-5 flex gap-3">
            <Button variant="soft" className="flex-1" onClick={() => setConfirmDelete(null)}>{t('取消', 'Cancel')}</Button>
            <Button variant="danger" className="flex-1" onClick={() => void doDelete(confirmDelete)}>{t('删除', 'Delete')}</Button>
          </div>
        </Modal>
      )}
    </div>
  )
}
