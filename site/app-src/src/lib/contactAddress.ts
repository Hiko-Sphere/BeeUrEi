import type { ContactAddress } from './api'

/// amap 绝对方位词（"东"/"东北"…，与用户朝向无关，便于转告）本地化：中文原样（仅放行标准八方位，异常值省略免读脏数据）；
/// 英文按八方位译；无法识别 → ''（绝不把生僻/异常中文方位读给英文用户）。与盲人端 WhereAmIComposer.directionWord 同口径。
const DIR_EN: Record<string, string> = {
  东: 'east', 南: 'south', 西: 'west', 北: 'north',
  东北: 'northeast', 东南: 'southeast', 西北: 'northwest', 西南: 'southwest',
}
function dirWord(raw: string | undefined, zh: boolean): string {
  const d = (raw || '').replace(/正/g, '').trim()
  if (!d) return ''
  if (zh) return ['东', '南', '西', '北', '东北', '东南', '西北', '西南'].includes(d) ? d : ''
  return DIR_EN[d] || ''
}
/// 方位+距离后缀（"，东约50米" / ", east about 50 m"）：距离缺/≤0/非有限 → 只留方位（有）或空。方位/距离服务端一直下发，
/// 此前 web 解码却丢弃=死字段——帮家人定位对方在路口/地标的**哪一侧、多远**（与盲人端「我在哪」同口径）。
function dirDistSuffix(direction: string | undefined, distanceMeters: number | undefined, zh: boolean): string {
  const dir = dirWord(direction, zh)
  const m = distanceMeters != null && Number.isFinite(distanceMeters) && distanceMeters > 0 ? Math.round(distanceMeters) : null
  if (m == null) return dir ? (zh ? `，${dir}侧` : ` (${dir})`) : ''
  return zh ? `，${dir}约${m}米` : `, ${dir ? dir + ' ' : ''}about ${m} m`
}

/// 联系人所在地 → 一句可读位置（与 iOS LiveLocationStrings.contactAddressText / 盲人端 WhereAmIComposer 同口径）：
/// 地址（address 空则退回 township）+ 所在区域 AOI + 最近路口（含方位/距离）+ 最近地标（含方位/距离），供家人一听即知对方在哪片、哪一侧。
///
/// **AOI 距离门 ≤300m**：太远的关联 AOI 不谎称对方"在 X 一带"——家人追踪盲人时复述一个远处 AOI 是**位置假报**
/// （对安全攸关的位置尤其不能假报，与盲人端 WhereAmIComposer 的 ≤300m 门同口径；此前 web 只据 aoi.name 无条件附）。
/// 距离未知（缺，旧数据/旧服务端）→ 仍显示（服务端 AOI 通常是点所属、距离≈0，向后兼容不因缺距离丢 AOI）；
/// 已知且 >300m 或非有限 → 跳过。同名两路不成交叉口→跳过；地标名已现于前文→跳过防赘述。
/// 地址与 township 皆空 → null（无地址，绝不硬凑"（在 X 一带）"这种半句）。纯逻辑，可单测。
export function composeContactAddress(r: ContactAddress, t: (zh: string, en: string) => string): string | null {
  const line = (r.address || r.township || '').trim()
  if (!line) return null
  let text = line
  const area = r.aoi?.name?.trim()
  const aoiDist = r.aoi?.distanceMeters
  const aoiClose = aoiDist == null || (Number.isFinite(aoiDist) && aoiDist <= 300)
  if (area && aoiClose && !text.includes(area)) {
    text = `${line}（${t('在', 'near ')}${area}${t('一带', '')}）`.trim()
  }
  const f = r.intersection?.firstRoad?.trim(); const sec = r.intersection?.secondRoad?.trim()
  if (f && sec && f !== sec) {
    const dir = r.intersection?.direction; const d = r.intersection?.distanceMeters
    text += t(`，附近路口${f}与${sec}交叉口${dirDistSuffix(dir, d, true)}`, `, nearby intersection ${f} and ${sec}${dirDistSuffix(dir, d, false)}`)
  }
  const lm = r.landmark?.name?.trim()
  if (lm && !text.includes(lm)) {
    const dir = r.landmark?.direction; const d = r.landmark?.distanceMeters
    text += t(`，最近地标${lm}${dirDistSuffix(dir, d, true)}`, `, nearest landmark ${lm}${dirDistSuffix(dir, d, false)}`)
  }
  return text
}
