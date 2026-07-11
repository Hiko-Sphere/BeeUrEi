import { useEffect, useState, type FormEvent } from 'react'
import { api, APIError, type SavedPlace } from '../lib/api'
import { appleMapsUrl, validLatLng } from '../lib/location'
import { useI18n } from '../lib/i18n'
import { Card, Button, useToast } from './ui'
import { IconPin } from './icons'

const MAX_PLACES = 30 // 与服务端 MAX_PLACES_PER_USER 一致

/// 常用地点（地理围栏）管理（Locations 页用；独立文件不碰 Leaflet，可在 jsdom 单测）：
/// 列出/新增/删除**本人**保存的地点（"家"/"公司"…）。共享位置时到达/离开这些地点会通知联系人——
/// 服务端此前仅 iOS 可管理、web 只收到达/离开通知却无从设置围栏；此组件补齐 web 侧管理，闭合围栏回路。
/// 只输入 label+地址：坐标由服务端保存时地理编码（amap→WGS-84），失败则无坐标、地点照存但无到达提醒（如实告知）。
export function SavedPlaces() {
  const { t } = useI18n()
  const toast = useToast()
  const [places, setPlaces] = useState<SavedPlace[] | null>(null)
  const [label, setLabel] = useState('')
  const [address, setAddress] = useState('')
  const [saving, setSaving] = useState(false)
  const [busyLabel, setBusyLabel] = useState<string | null>(null)

  const load = () => api.savedPlaces().then((r) => setPlaces(r.places)).catch(() => setPlaces([]))
  useEffect(() => { void load() }, [])

  const add = async (e: FormEvent) => {
    e.preventDefault()
    const lb = label.trim(), ad = address.trim()
    if (!lb || !ad || saving) return
    setSaving(true)
    try {
      const r = await api.upsertPlace(lb, ad)
      setLabel(''); setAddress('')
      await load()
      // 地理编码失败（未配 amap/境外/查不到）→ 坐标为空、无围栏：不谎称"到达提醒已开"，如实提示。
      if (r.place.lat == null) toast(t(`已保存"${lb}"，但未能定位该地址，暂无到达提醒`, `Saved "${lb}", but couldn't locate the address — no arrival alerts`), 'info')
      else toast(t(`已保存"${lb}"`, `Saved "${lb}"`), 'ok')
    } catch (err) {
      const code = err instanceof APIError ? err.status : 0
      toast(code === 429 ? t(`常用地点已达 ${MAX_PLACES} 个上限`, `Reached the limit of ${MAX_PLACES} saved places`)
        : code === 403 ? t('内容含违禁词，未能保存', 'Blocked: the text contains disallowed words')
        : t('保存失败，请重试', 'Save failed — try again'), 'error')
    } finally { setSaving(false) }
  }

  const remove = async (p: SavedPlace) => {
    // 删除前确认：家人靠"家/公司"围栏知道你何时到达，误删会静默失去到达提醒。
    if (!confirm(t(`删除常用地点"${p.label}"？`, `Delete saved place "${p.label}"?`))) return
    setBusyLabel(p.label)
    try { await api.deletePlace(p.label); await load() }
    catch { toast(t('删除失败，请重试', 'Delete failed — try again'), 'error') }
    finally { setBusyLabel(null) }
  }

  const list = places ?? []
  const atLimit = list.length >= MAX_PLACES
  return (
    <Card className="overflow-hidden">
      <div className="border-b border-[var(--line)] px-4 py-3">
        <div className="text-sm font-semibold">{t('常用地点', 'Saved places')}</div>
        <p className="mt-0.5 text-xs text-faint">{t('共享位置时，你到达或离开这些地点会通知你的联系人。', 'While sharing your location, arriving at or leaving these places notifies your contacts.')}</p>
      </div>

      {places === null ? (
        <div className="px-4 py-3 text-sm text-faint">{t('加载中…', 'Loading…')}</div>
      ) : list.length === 0 ? (
        <div className="px-4 py-3 text-sm text-faint">{t('还没有常用地点。添加"家""公司"等，方便亲友知道你何时到达。', 'No saved places yet. Add "Home", "Work", etc. so your contacts know when you arrive.')}</div>
      ) : (
        <ul className="divide-y divide-[var(--line)]">
          {list.map((p) => {
            // validLatLng 是渲染地图链接前的既定守卫：null/NaN/越界一律视作"无可用坐标"，即便服务端回了坏坐标也
            // 优雅退化为"未定位"告警，绝不拼出坏链接。有坐标→给"在地图上核对"外链（地址地理编码常有偏差，
            // 让用户亲眼确认"家"落对地方；落错→到达提醒会静默失灵，家人干等，故核对是安全相关而非纯装饰）。
            const ll = validLatLng(p.lat, p.lng)
            return (
            <li key={p.label} className="flex items-center gap-3 px-4 py-3">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-honey/15 text-honey"><IconPin width={16} height={16} /></span>
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium">{p.label}</div>
                <div className="truncate text-xs text-faint">{p.address}</div>
                {ll
                  ? <a href={appleMapsUrl(ll.lat, ll.lng, p.label)} target="_blank" rel="noopener noreferrer"
                       className="text-[11px] text-accent hover:underline"
                       aria-label={t(`在地图上核对 ${p.label} 的位置是否正确`, `Verify ${p.label}'s location on the map`)}>{t('在地图上核对位置', 'Verify on map')}</a>
                  : <div className="text-[11px] text-danger">{t('未能定位此地址，暂无到达提醒', "Couldn't locate this address — no arrival alerts")}</div>}
              </div>
              <button type="button" onClick={() => void remove(p)} disabled={busyLabel === p.label}
                className="shrink-0 rounded-lg px-2.5 py-1.5 text-xs font-medium text-danger transition hover:bg-danger/10 disabled:cursor-not-allowed disabled:opacity-50"
                aria-label={t(`删除常用地点 ${p.label}`, `Delete saved place ${p.label}`)}>{t('删除', 'Delete')}</button>
            </li>
            )
          })}
        </ul>
      )}

      {atLimit ? (
        <div className="border-t border-[var(--line)] px-4 py-3 text-xs text-faint">{t(`已达 ${MAX_PLACES} 个上限，删除一个再添加。`, `Reached the limit of ${MAX_PLACES}. Delete one to add more.`)}</div>
      ) : (
        <form onSubmit={add} className="flex flex-wrap items-end gap-2 border-t border-[var(--line)] px-4 py-3">
          <label className="flex flex-col gap-1 text-xs">
            <span className="text-faint">{t('名称', 'Name')}</span>
            <input value={label} onChange={(e) => setLabel(e.target.value)} maxLength={32} placeholder={t('家', 'Home')}
              aria-label={t('地点名称', 'Place name')}
              className="w-28 rounded-lg border border-[var(--line)] surface-2 px-2 py-1.5 text-sm outline-none" />
          </label>
          <label className="flex min-w-[10rem] flex-1 flex-col gap-1 text-xs">
            <span className="text-faint">{t('地址', 'Address')}</span>
            <input value={address} onChange={(e) => setAddress(e.target.value)} maxLength={200} placeholder={t('北京市朝阳区…', 'Street address…')}
              aria-label={t('地址', 'Address')}
              className="w-full rounded-lg border border-[var(--line)] surface-2 px-2 py-1.5 text-sm outline-none" />
          </label>
          <Button type="submit" disabled={saving || !label.trim() || !address.trim()}>{t('保存', 'Save')}</Button>
        </form>
      )}
    </Card>
  )
}
