import type { ContactAddress } from './api'

/// 联系人所在地 → 一句可读位置（与 iOS LiveLocationStrings.contactAddressText / 盲人端 WhereAmIComposer 同口径）：
/// 地址（address 空则退回 township）+ 所在区域 AOI + 最近路口 + 最近地标，供家人一听即知对方在哪片。
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
    text += t(`，附近路口${f}与${sec}交叉口`, `, nearby intersection ${f} and ${sec}`)
  }
  const lm = r.landmark?.name?.trim()
  if (lm && !text.includes(lm)) {
    text += t(`，最近地标${lm}`, `, nearest landmark ${lm}`)
  }
  return text
}
