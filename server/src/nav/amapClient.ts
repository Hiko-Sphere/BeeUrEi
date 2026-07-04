/// 高德 Web 服务客户端（国内步行导航）。Key 从环境变量读取（.env，仅后端持有，不进 App）。
const AMAP_BASE = 'https://restapi.amap.com/v3'

export interface WalkStep {
  instruction: string
  distanceMeters: number
  /// 该步折线坐标（GCJ-02，[lat, lon] 数组）。首点即该步转向点，供 App 实时逐向引导/偏航检测。
  polyline: Array<[number, number]>
}

function apiKey(): string | undefined {
  return process.env.AMAP_API_KEY
}

export function amapConfigured(): boolean {
  return !!apiKey()
}

/// 高德 Web 服务调用失败（key 平台不符 / 配额 / 鉴权 / 网络等）。携带高德的 infocode/info 以便诊断与上报，
/// 区别于"地址确实查不到"。最常见：USERKEY_PLAT_NOMATCH(10009)——key 不是「Web服务」类型（见 .env.example）。
export class AmapError extends Error {
  infocode: string
  info: string
  constructor(infocode: string, info: string) {
    super(`amap ${infocode}: ${info}`)
    this.name = 'AmapError'
    this.infocode = infocode
    this.info = info
  }
}

/// 高德成功 status='1' 且 infocode='10000'；失败 status='0' 且带 info/infocode。
/// 不校验会把"key 配置错误"静默当成"目的地未找到"，对盲人导航是致命的误导（见审查）。
function assertAmapOk(res: Response, data: { status?: string; info?: string; infocode?: string }): void {
  if (!res.ok) throw new AmapError(`http_${res.status}`, `HTTP ${res.status}`)
  if (data.status !== '1') throw new AmapError(data.infocode ?? 'unknown', data.info ?? 'unknown')
}

/// 地址 → "经度,纬度"（GCJ-02）。返回 undefined 表示**地址确实无匹配**；key/配额等错误抛 AmapError。
export async function amapGeocode(address: string): Promise<string | undefined> {
  const key = apiKey()
  if (!key) return undefined
  const url = `${AMAP_BASE}/geocode/geo?address=${encodeURIComponent(address)}&key=${key}`
  const res = await fetch(url)
  const data = (await res.json()) as { status?: string; info?: string; infocode?: string; geocodes?: Array<{ location?: string }> }
  assertAmapOk(res, data) // key 平台不符/配额等 → 抛 AmapError，不静默退化成"未找到"
  return data.geocodes?.[0]?.location
}

/// 步行路线（origin/destination 均为 "经度,纬度"）。返回逐步指令。key/配额等错误抛 AmapError。
export async function amapWalking(origin: string, destination: string): Promise<WalkStep[]> {
  const key = apiKey()
  if (!key) return []
  const url = `${AMAP_BASE}/direction/walking?origin=${origin}&destination=${destination}&key=${key}`
  const res = await fetch(url)
  const data = (await res.json()) as {
    status?: string; info?: string; infocode?: string
    route?: { paths?: Array<{ steps?: Array<{ instruction?: string; distance?: string; polyline?: string }> }> }
  }
  assertAmapOk(res, data)
  const steps = data.route?.paths?.[0]?.steps ?? []
  return steps.map((s) => {
    // 高德某步 distance 若是非数字字符串，Number(...) 得 NaN，JSON.stringify 会序列化成 null，
    // 致客户端整条路线解码失败、丢失整条路线 → 用 0 兜底，绝不外发 NaN（见审查 #8）。
    const d = Number(s.distance ?? 0)
    return {
      instruction: s.instruction ?? '',
      distanceMeters: Number.isFinite(d) ? d : 0,
      polyline: parsePolyline(s.polyline),
    }
  })
}

/// 周边 POI（GCJ-02 坐标 + 名称 + 类型 + 高德算好的直线距离米）。用于「周围有什么」——国内 Apple Maps POI
/// 覆盖稀疏，改用高德 place/around 拿到密集且中文准确的地点，App 端再按时钟方位播报（PoiCalloutComposer）。
export interface AroundPoi {
  name: string
  /// GCJ-02 纬度/经度（与 App 把用户位置转 GCJ-02 后同系，方位角计算才正确）。
  lat: number
  lon: number
  /// 高德返回的直线距离（米，权威，直接用于播报，勿客户端再算免坐标系混用）。
  distanceMeters: number
  /// 地点大类中文描述（如"便利店""餐饮"），高德 type 的首段；无则空串。
  category: string
}

/// 周边 POI 检索（location="经度,纬度" GCJ-02，radius 米）。key/配额等错误抛 AmapError；无 key 返回 []。
/// keywords 可选（如"便利店""卫生间"）；空则按距离取周边全部类型。上限 offset=25/页取第一页足够播报。
export async function amapAround(location: string, radiusMeters: number, keywords?: string): Promise<AroundPoi[]> {
  const key = apiKey()
  if (!key) return []
  const kw = keywords && keywords.trim() ? `&keywords=${encodeURIComponent(keywords.trim())}` : ''
  const url = `${AMAP_BASE}/place/around?location=${location}&radius=${radiusMeters}${kw}`
    + `&offset=25&page=1&extensions=base&sortrule=distance&key=${key}`
  const res = await fetch(url)
  const data = (await res.json()) as {
    status?: string; info?: string; infocode?: string
    pois?: Array<{ name?: string; location?: string; distance?: string; type?: string }>
  }
  assertAmapOk(res, data) // key 平台不符/配额 → 抛 AmapError，不静默当"周围什么都没有"
  const out: AroundPoi[] = []
  for (const p of data.pois ?? []) {
    const name = (p.name ?? '').trim()
    if (!name) continue
    const [lonS, latS] = (p.location ?? '').split(',')
    const lon = Number(lonS), lat = Number(latS)
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue
    const d = Number(p.distance ?? 0)
    // type 形如"餐饮服务;中餐厅;..."，取末段最具体的分类中文；无则空。
    const cats = (p.type ?? '').split(';').map((s) => s.trim()).filter(Boolean)
    out.push({
      name,
      lat,
      lon,
      distanceMeters: Number.isFinite(d) && d >= 0 ? d : 0, // 绝不外发 NaN/负距离
      category: cats[cats.length - 1] ?? '',
    })
  }
  return out
}

/// 高德折线 "lon,lat;lon,lat;…"（GCJ-02）→ [[lat, lon]]。非法点跳过，绝不外发 NaN。
function parsePolyline(raw: string | undefined): Array<[number, number]> {
  if (!raw) return []
  const pts: Array<[number, number]> = []
  for (const seg of raw.split(';')) {
    const [lonS, latS] = seg.split(',')
    const lon = Number(lonS), lat = Number(latS)
    if (Number.isFinite(lat) && Number.isFinite(lon) && Math.abs(lat) <= 90 && Math.abs(lon) <= 180) {
      pts.push([lat, lon])
    }
  }
  return pts
}
