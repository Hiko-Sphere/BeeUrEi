/// 高德 Web 服务客户端（国内步行导航）。Key 从环境变量读取（.env，仅后端持有，不进 App）。
const AMAP_BASE = 'https://restapi.amap.com/v3'

/// 每次高德调用的硬超时（毫秒，AMAP_TIMEOUT_MS 可调，默认 6s）。**必须有**：Node fetch 无默认超时，
/// 高德慢/挂/被墙时裸 fetch 会无限期挂住服务端连接，nav 端点每次还要打 2-3 次高德 → 请求堆积、资源耗尽
/// （慢上游型 DoS）。与商品查询/AI 视觉同款 AbortController 硬中止。每次调用读 env（便于测试注入短超时）。
function amapTimeoutMs(): number {
  const n = Number(process.env.AMAP_TIMEOUT_MS)
  return Number.isFinite(n) && n > 0 ? n : 6000
}
/// 带硬超时 + **瞬时网络失败重试一次**的高德调用。重试策略刻意保守：
/// - 我们自己的超时（signal.aborted）**不重试**——已等满一个超时窗，再等一次会让盲人多等一倍；
/// - 高德的语义错误（status!=1，如 USERKEY_PLAT_NOMATCH/未找到）不走这里（在 assertAmapOk 抛），不会被重试；
/// - 只对纯网络瞬断（连接被拒/重置等 fetch 抛错）重试一次，透明恢复高德侧的偶发抖动，盲人无感。
async function amapFetch(url: string): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), amapTimeoutMs())
    try {
      return await fetch(url, { signal: ctrl.signal })
    } catch (e) {
      if (ctrl.signal.aborted || attempt >= 1) throw e // 超时不重试；已重试过一次则放弃
    } finally {
      clearTimeout(timer) // 成功/失败都清定时器，避免泄漏
    }
  }
}

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
  const res = await amapFetch(url)
  const data = (await res.json()) as { status?: string; info?: string; infocode?: string; geocodes?: Array<{ location?: string }> }
  assertAmapOk(res, data) // key 平台不符/配额等 → 抛 AmapError，不静默退化成"未找到"
  return data.geocodes?.[0]?.location
}

/// 步行路线（origin/destination 均为 "经度,纬度"）。返回逐步指令。key/配额等错误抛 AmapError。
export async function amapWalking(origin: string, destination: string): Promise<WalkStep[]> {
  const key = apiKey()
  if (!key) return []
  const url = `${AMAP_BASE}/direction/walking?origin=${origin}&destination=${destination}&key=${key}`
  const res = await amapFetch(url)
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
  const res = await amapFetch(url)
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

/// 高德数值字段一律是**字符串**（如距离"1200"、时长"600"）。转有限非负数，否则 0——绝不外发 NaN/负值。
function numOrZero(s: string | undefined): number {
  const n = Number(s ?? 0)
  return Number.isFinite(n) && n >= 0 ? n : 0
}

/// 逆地理编码取行政区 adcode（公交路径规划的 city 参数必填，用起点 adcode）。key/配额等错误抛 AmapError；无 key/无匹配→undefined。
/// 注意：高德 regeo 的 city 字段在直辖市会返回空数组，故用恒为字符串的 adcode，不用 city。
export async function amapRegeoAdcode(location: string): Promise<string | undefined> {
  const key = apiKey()
  if (!key) return undefined
  const url = `${AMAP_BASE}/geocode/regeo?location=${location}&extensions=base&key=${key}`
  const res = await amapFetch(url)
  const data = (await res.json()) as {
    status?: string; info?: string; infocode?: string
    regeocode?: { addressComponent?: { adcode?: string; citycode?: string } }
  }
  assertAmapOk(res, data)
  const adcode = data.regeocode?.addressComponent?.adcode
  return adcode && /^\d{4,8}$/.test(adcode) ? adcode : undefined
}

/// 一段公交出行腿：步行 / 公交 / 地铁 / 火车。数值均米/秒（已由字符串转安全数）。
export type TransitLegKind = 'walk' | 'bus' | 'subway' | 'railway'
export interface TransitLeg {
  kind: TransitLegKind
  line?: string           // 线路名（"1号线"/"300路"/车次），已去掉"(始发-终点)"括注
  fromStop?: string       // 上车站
  toStop?: string         // 下车站
  stops?: number          // 乘坐站数（含到站）
  distanceMeters: number  // 步行距离 或 乘车区间距离
  durationSeconds: number
}
/// 一个完整公交方案（取高德推荐的第一条）：总时长/总步行 + 有序的腿。
export interface TransitPlan {
  durationSeconds: number
  walkingDistanceMeters: number
  legs: TransitLeg[]
}

/// 线路名去掉括注："300路(北京站东-马家堡)" → "300路"；"地铁1号线(苹果园--四惠东)" → "地铁1号线"。
function cleanLineName(name: string | undefined): string {
  const n = (name ?? '').trim()
  const cut = n.search(/[(（]/)
  return (cut > 0 ? n.slice(0, cut) : n).trim()
}

/// 公交/地铁路径规划（origin/destination="经度,纬度" GCJ-02，city=起点 adcode）。返回高德推荐的第一条方案；
/// 无方案（太近应步行/无公交覆盖/跨城无直达）→ null（路由据此回 404，区别于 key 错误）。key/配额等错误抛 AmapError。
/// 高德会把每个 segment 的 walking/bus/entrance/exit/railway 键都返回、空的用空对象/空数组占位——故按**内容非空**判定该腿是否存在。
export async function amapTransit(origin: string, destination: string, city: string): Promise<TransitPlan | null> {
  const key = apiKey()
  if (!key) return null
  const url = `${AMAP_BASE}/direction/transit/integrated?origin=${origin}&destination=${destination}`
    + `&city=${encodeURIComponent(city)}&strategy=0&nightflag=0&key=${key}`
  const res = await amapFetch(url)
  interface Stop { name?: string }
  interface Busline {
    name?: string; type?: string; via_num?: string; distance?: string; duration?: string
    departure_stop?: Stop; arrival_stop?: Stop
  }
  interface Segment {
    walking?: { distance?: string; duration?: string }
    bus?: { buslines?: Busline[] }
    railway?: { name?: string; trip?: string; distance?: string; time?: string; departure_stop?: Stop; arrival_stop?: Stop }
  }
  const data = (await res.json()) as {
    status?: string; info?: string; infocode?: string
    route?: { transits?: Array<{ duration?: string; walking_distance?: string; segments?: Segment[] }> }
  }
  assertAmapOk(res, data)
  const transit = data.route?.transits?.[0]
  if (!transit) return null // 无公交方案
  const legs: TransitLeg[] = []
  for (const seg of transit.segments ?? []) {
    const wDist = numOrZero(seg.walking?.distance)
    // 只在步行距离 >0 时报步行腿：站内换乘的 0 米步行由相邻乘车腿的"换乘"措辞承载，报"步行0米"反而困惑（复审#1，刻意）。
    if (wDist > 0) legs.push({ kind: 'walk', distanceMeters: wDist, durationSeconds: numOrZero(seg.walking?.duration) })
    const line = seg.bus?.buslines?.[0] // 同段多线路只取首条：给盲人一条明确指令，胜过"坐300或特8或快1"的听觉负担（复审#4，刻意）
    if (line && (line.name ?? '').trim()) {
      // 地铁判定只认权威的 type（含"地铁"/"轨道"）或名字含"地铁"；**不**用"号线$"结尾猜——
      // "旅游1号线""社区5号线"等是普通公交却以"号线"结尾，会被误报成地铁把盲人指去找不存在的地铁站（复审#3）。
      const isSubway = (line.type ?? '').includes('地铁') || (line.type ?? '').includes('轨道') || cleanLineName(line.name).includes('地铁')
      // via_num=途经中间站数，+1=含到站的乘坐站数。**缺该字段时不臆造**——否则 numOrZero→0→"坐1站"会让盲人在第一站就下车（复审#2）。
      const viaRaw = line.via_num
      const stops = viaRaw != null && viaRaw !== '' && Number.isFinite(Number(viaRaw)) && Number(viaRaw) >= 0
        ? Number(viaRaw) + 1 : undefined
      legs.push({
        kind: isSubway ? 'subway' : 'bus',
        line: cleanLineName(line.name),
        fromStop: (line.departure_stop?.name ?? '').trim() || undefined,
        toStop: (line.arrival_stop?.name ?? '').trim() || undefined,
        stops,
        distanceMeters: numOrZero(line.distance),
        durationSeconds: numOrZero(line.duration),
      })
    }
    const rw = seg.railway
    const rwName = (rw?.trip || rw?.name || '').trim()
    if (rw && rwName) {
      legs.push({
        kind: 'railway',
        line: rwName,
        fromStop: (rw.departure_stop?.name ?? '').trim() || undefined,
        toStop: (rw.arrival_stop?.name ?? '').trim() || undefined,
        distanceMeters: numOrZero(rw.distance),
        durationSeconds: numOrZero(rw.time),
      })
    }
  }
  if (legs.length === 0) return null // 有 transit 壳但无可用腿（异常数据）→ 视为无方案
  return { durationSeconds: numOrZero(transit.duration), walkingDistanceMeters: numOrZero(transit.walking_distance), legs }
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
