// 解析位置消息文本：两种形态都认——
//  ① JSON {lat,lng,name?}（App/web 主动发的位置）
//  ② 内嵌 https://maps.apple.com/?ll=lat,lng&q=name 文本链接（iOS 兼容未升级服务端时发的形态）
// 均做经纬度范围与有限性校验；任何畸形/越界/非位置输入返回 null（绝不抛错——文本来自用户可控消息）。
export function parseLocation(text: string): { lat: number; lng: number; name?: string } | null {
  // 防御：text 类型虽为 string，但消息字段可能因后端数据异常为 null/undefined——
  // 下方 text.indexOf 在 try/catch 之外，无此守卫会抛 TypeError、连累整条聊天列表/会话渲染崩。
  if (typeof text !== 'string' || text === '') return null
  try {
    const j = JSON.parse(text) as { lat?: unknown; lng?: unknown; name?: unknown }
    if (typeof j.lat === 'number' && typeof j.lng === 'number'
        && j.lat >= -90 && j.lat <= 90 && j.lng >= -180 && j.lng <= 180) {
      return { lat: j.lat, lng: j.lng, name: typeof j.name === 'string' ? j.name : undefined }
    }
  } catch { /* 非 JSON：尝试文本链接形式 */ }
  const i = text.indexOf('https://maps.apple.com/?ll=')
  if (i < 0) return null
  try {
    const u = new URL(text.slice(i).split(/\s/)[0]) // 取到首个空白为止
    const parts = (u.searchParams.get('ll') ?? '').split(',')
    if (parts.length !== 2) return null
    const lat = Number(parts[0]), lng = Number(parts[1])
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) return null
    return { lat, lng, name: u.searchParams.get('q') || undefined }
  } catch { return null }
}
