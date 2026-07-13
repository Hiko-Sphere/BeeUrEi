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
/// 可观测性钩子（buildApp 注入，与 notify 的 setNotifyWebPush 同先例）：高德是**限额/计费**外部依赖，
/// 监控调用量/超时/网络失败/上游错误(key 平台不符·配额耗尽)对运维至关重要。默认 noop（未注入不计）。
/// hook 第二参 detail：失败原因短文本（如上游 `USERKEY_PLAT_NOMATCH: key 平台不符` / `timeout`）——供 admin 面板
/// 显示"高德为什么失败"，不必翻日志。key 平台配错是自托管最常见坑（须「Web服务」类型），有了原因一眼可修。
let amapMetric: (name: string, detail?: string) => void = () => {}
export function setAmapMetrics(hook: (name: string, detail?: string) => void): void { amapMetric = hook }

/// 熔断器（circuit breaker，resilience 标配）：高德持续故障（超时/网络失败）时**快速失败**而非每次都等满超时。
/// 三态：closed（正常）→ 连续失败达阈值 → open（冷却期内直接快失败，不再打高德）→ 冷却满 → halfOpen（放一个探测请求）
/// → 成功则 closed、失败则重新 open。**只统计 fetch 层失败**（超时/网络）——语义错误（status!=1）在 fetch 成功后抛，
/// 记为成功、不拖垮熔断（key 配错本就快失败、无需熔断）。收益：高德挂时盲人瞬间得到"导航暂不可用"（而非苦等 6-12s），
/// 且不再向已挂的上游堆连接。纯状态机（now 由调用方传，可单测）。
export class AmapCircuit {
  private failures = 0
  private openedAt = 0
  private state: 'closed' | 'open' | 'halfOpen' = 'closed'
  constructor(private readonly threshold: number, private readonly cooldownMs: number) {}
  /// 现在是否放行请求。open 且冷却已满 → 转 halfOpen 放**一个**探测（返回 true）；冷却未满 → false（快失败）。
  /// halfOpen 期间其余请求一律快失败——**单探测**，避免恢复瞬间一批并发请求同时涌向可能仍挂的上游（惊群）。
  canRequest(now: number): boolean {
    if (this.state === 'open') {
      if (now - this.openedAt >= this.cooldownMs) { this.state = 'halfOpen'; return true } // 这一个请求即探测
      return false
    }
    if (this.state === 'halfOpen') return false // 探测进行中，其余快失败
    return true // closed
  }
  onSuccess(): void { this.failures = 0; this.state = 'closed' }
  /// 记一次失败；返回本次是否**刚**跳到 open（供只计一次开路指标）。halfOpen 下任一失败立即重新 open。
  onFailure(now: number): boolean {
    this.failures++
    if (this.state !== 'open' && (this.state === 'halfOpen' || this.failures >= this.threshold)) {
      this.state = 'open'; this.openedAt = now
      return true
    }
    return false
  }
  reset(): void { this.failures = 0; this.openedAt = 0; this.state = 'closed' }
  get stateName(): 'closed' | 'open' | 'halfOpen' { return this.state }
}

function makeAmapBreaker(): AmapCircuit {
  const th = Number(process.env.AMAP_BREAKER_THRESHOLD)   // 连续失败阈值（默认 5）
  const cd = Number(process.env.AMAP_BREAKER_COOLDOWN_MS)  // 冷却毫秒（默认 30s）
  return new AmapCircuit(Number.isFinite(th) && th >= 1 ? th : 5, Number.isFinite(cd) && cd >= 1000 ? cd : 30_000)
}
let amapBreaker = makeAmapBreaker()
/// 测试隔离/配置重载：按当前 env 重建熔断器（生产不调用——buildApp 只构造一次）。
export function resetAmapBreaker(): void { amapBreaker = makeAmapBreaker() }

/// 带硬超时 + 网络瞬断重试一次的实际调用（不含熔断）。allowRetry=false 时**不重试**——用于 halfOpen 探测：
/// 探测只为尽快判定"高德恢复了没"，失败无论如何都要重新熔断，多等一次重试只会把恢复判定拖慢一倍（复审 MEDIUM）。
async function amapFetchInner(url: string, allowRetry: boolean): Promise<Response> {
  for (let attempt = 0; ; attempt++) {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), amapTimeoutMs())
    try {
      amapMetric('amap_calls_total') // 每次实际 fetch（含重试）——监控配额消耗
      return await fetch(url, { signal: ctrl.signal })
    } catch (e) {
      amapMetric(ctrl.signal.aborted ? 'amap_timeouts_total' : 'amap_errors_total', ctrl.signal.aborted ? 'timeout' : 'network error')
      if (ctrl.signal.aborted || !allowRetry || attempt >= 1) throw e // 超时不重试；探测不重试；已重试过一次则放弃
    } finally {
      clearTimeout(timer) // 成功/失败都清定时器，避免泄漏
    }
  }
}

/// 高德调用（含熔断）：open 期间直接快失败（AmapError('breaker_open')，被 nav 路由映射为 502），
/// 不再苦等超时、不再向已挂上游堆连接。fetch 成功 → 复位；fetch 失败（超时/网络）→ 计入熔断。
async function amapFetch(url: string): Promise<Response> {
  if (!amapBreaker.canRequest(Date.now())) {
    amapMetric('amap_breaker_rejected_total')
    throw new AmapError('breaker_open', 'AMap 暂时不可用（连续故障已熔断，稍后自动恢复）')
  }
  // canRequest 刚把 open 转成 halfOpen 时，本次即"探测请求"——不重试，尽快得到恢复判定。
  const isProbe = amapBreaker.stateName === 'halfOpen'
  try {
    const res = await amapFetchInner(url, !isProbe)
    amapBreaker.onSuccess()
    return res
  } catch (e) {
    if (amapBreaker.onFailure(Date.now())) amapMetric('amap_breaker_open_total') // 刚跳 open，计一次
    throw e
  }
}

export interface WalkStep {
  instruction: string
  distanceMeters: number
  /// 该步折线坐标（GCJ-02，[lat, lon] 数组）。首点即该步转向点，供 App 实时逐向引导/偏航检测。
  polyline: Array<[number, number]>
}

/// 一条步行路线：分步 + 高德给出的**全程**距离/时长。全程数据每个导航 App 都在起步先播（"全程约 800 米、
/// 步行约 12 分钟"），盲人据此判断这趟值不值得走、要不要改坐公交——此前只取 steps、把高德已返回的
/// path.distance/duration 丢弃了（与 transit 端点已返 durationSeconds 不对齐）。totals 用高德的**权威值**，
/// 而非把各步 distance 相加（后者会因非数字步兜底为 0 而系统性偏小）。
export interface WalkRoute {
  steps: WalkStep[]
  distanceMeters: number   // 全程距离（米，取整，坏值→0）
  durationSeconds: number  // 全程预计步行时长（秒，取整，坏值→0）
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
  if (!res.ok) { amapMetric('amap_upstream_errors_total', `HTTP ${res.status}`); throw new AmapError(`http_${res.status}`, `HTTP ${res.status}`) }
  if (data.status !== '1') {
    // 上游语义错误：把 infocode+info 作原因（如 `10009: USERKEY_PLAT_NOMATCH`——key 不是「Web服务」类型，自托管头号坑）。
    amapMetric('amap_upstream_errors_total', `${data.infocode ?? 'unknown'}: ${data.info ?? 'unknown'}`)
    throw new AmapError(data.infocode ?? 'unknown', data.info ?? 'unknown')
  }
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
export async function amapWalking(origin: string, destination: string): Promise<WalkRoute> {
  const key = apiKey()
  if (!key) return { steps: [], distanceMeters: 0, durationSeconds: 0 }
  const url = `${AMAP_BASE}/direction/walking?origin=${origin}&destination=${destination}&key=${key}`
  const res = await amapFetch(url)
  const data = (await res.json()) as {
    status?: string; info?: string; infocode?: string
    route?: { paths?: Array<{ distance?: string; duration?: string; steps?: Array<{ instruction?: string; distance?: string; polyline?: string }> }> }
  }
  assertAmapOk(res, data)
  const path = data.route?.paths?.[0]
  const steps = (path?.steps ?? []).map((s) => {
    // 高德某步 distance 若是非数字字符串，Number(...) 得 NaN，JSON.stringify 会序列化成 null，
    // 致客户端整条路线解码失败、丢失整条路线 → 用 0 兜底，绝不外发 NaN（见审查 #8）。
    const d = Number(s.distance ?? 0)
    return {
      instruction: s.instruction ?? '',
      distanceMeters: Number.isFinite(d) ? d : 0,
      polyline: parsePolyline(s.polyline),
    }
  })
  // 全程距离/时长用高德**路线级**权威值（坏值一律兜 0，绝不外发 NaN/负数——与逐步 distance 同口径）。
  const totalDist = Number(path?.distance ?? 0)
  const totalDur = Number(path?.duration ?? 0)
  return {
    steps,
    distanceMeters: Number.isFinite(totalDist) && totalDist >= 0 ? Math.round(totalDist) : 0,
    durationSeconds: Number.isFinite(totalDur) && totalDur >= 0 ? Math.round(totalDur) : 0,
  }
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
  /// 地点分类中文描述，取高德 type 的**末段（最具体）**——如 type "餐饮服务;快餐厅;肯德基" 取"肯德基"、
  /// "购物服务;便民商店;便利店" 取"便利店"。**刻意取末段而非首段**：末段是最具体的品牌/子类，对盲人 POI 播报
  /// 远比笼统首段（"餐饮服务""购物服务"）有用。切勿据此注释误改成 cats[0]（见 amapAround 与其单测锁定）。无则空串。
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

/// 高德 regeo 的"空"字段返回**空数组 []**（而非空串/缺省）——这是 regeo 特有大坑：不归一会把 [] 当地址、
/// 或对 [] 调 .trim() 崩。一律归一成字符串，非字符串一律空串。
function amapStr(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

/// 逆地理编码结果：可播报的完整地址 + 最近显著地标（"我在哪"国内数据源）。
export interface AmapReverseGeocode {
  /// 高德格式化地址（如"北京市朝阳区呼家楼街道…"）；无则空串。
  address: string
  /// 街道/乡镇（addressComponent.township），供更口语的"你在X街道附近"。空则空串。
  township: string
  /// 最近的显著地标：POI 名 + **绝对方位词**（东/东北…，与用户朝向无关，便于向出租车/路人转述）+ 直线距离米。缺则 undefined。
  landmark?: { name: string; direction: string; distanceMeters: number }
  /// 最近的**路口/交叉口**（两条相交路名 + 绝对方位 + 直线距离米）：盲人定位与向路人/司机说明"在哪个路口"
  /// 的天然锚点（对标 Soundscape / BlindSquare 的路口播报，往往比 POI 地标更利于定向）。缺则 undefined。
  intersection?: { firstRoad: string; secondRoad: string; direction: string; distanceMeters: number }
}

/// 逆地理编码（location="经度,纬度" GCJ-02）→ 可播报地址 + 最近地标。
/// 境内 Apple CLGeocoder 的中文地址粒度粗、门牌常缺；高德 regeo 更准更细且带周边 POI 绝对方位，
/// 与「周围有什么」改用高德同因（境内 Apple 数据稀疏）。key/配额等错误抛 AmapError；无 key/无结果→undefined。
export async function amapReverseGeocode(location: string): Promise<AmapReverseGeocode | undefined> {
  const key = apiKey()
  if (!key) return undefined
  // extensions=all 才返回 pois/roads（base 只有行政区划）；radius=200 限定"最近地标"的检索半径。
  const url = `${AMAP_BASE}/geocode/regeo?location=${location}&extensions=all&radius=200&key=${key}`
  const res = await amapFetch(url)
  const data = (await res.json()) as {
    status?: string; info?: string; infocode?: string
    regeocode?: {
      formatted_address?: unknown
      addressComponent?: { township?: unknown }
      pois?: Array<{ name?: unknown; direction?: unknown; distance?: unknown }>
      roadinters?: Array<{ first_name?: unknown; second_name?: unknown; direction?: unknown; distance?: unknown }>
    }
  }
  assertAmapOk(res, data)
  const rc = data.regeocode
  if (!rc) return undefined
  const address = amapStr(rc.formatted_address).trim()
  const township = amapStr(rc.addressComponent?.township).trim()
  // 最近地标：POI 里距离最小的**有效**项（高德未必按距离排序，必须自己挑）。
  let landmark: AmapReverseGeocode['landmark'] | undefined
  let best = Infinity
  for (const p of rc.pois ?? []) {
    const name = amapStr(p.name).trim()
    if (!name) continue
    // 空距离必须先剔：高德空字段是 []→amapStr→''，而 **Number('')===0**，会把无距离的 POI 伪装成"0 米"、
    // 抢占最近地标名额，向盲人报错的地标且称"就在脚下"（对转述定位的功能是危险误导，见对抗复审 BUG 1）。
    // 真正 0 米的 POI 会以字符串 '0' 到达、照常保留。
    const ds = amapStr(p.distance).trim()
    if (!ds) continue
    const d = Number(ds)
    if (!Number.isFinite(d) || d < 0) continue
    if (d < best) { best = d; landmark = { name, direction: amapStr(p.direction).trim(), distanceMeters: d } }
  }
  // 最近路口（交叉口）：取 roadinters 里距离最小的**有效**项（两条路名都在）。高德同样未必按距离排序，自己挑。
  let intersection: AmapReverseGeocode['intersection'] | undefined
  let bestInter = Infinity
  for (const ri of rc.roadinters ?? []) {
    const first = amapStr(ri.first_name).trim()
    const second = amapStr(ri.second_name).trim()
    if (!first || !second) continue // 须两条相交路名齐全，否则不成"交叉口"
    const ds = amapStr(ri.distance).trim()
    if (!ds) continue // 空距离陷阱同 POI：高德空字段 []→''→Number('')===0，会伪装成"0米"抢最近名额，先剔
    const d = Number(ds)
    if (!Number.isFinite(d) || d < 0) continue
    if (d < bestInter) { bestInter = d; intersection = { firstRoad: first, secondRoad: second, direction: amapStr(ri.direction).trim(), distanceMeters: d } }
  }
  if (!address && !township && !landmark && !intersection) return undefined // 什么都没有 → 视作无结果（上层回退 Apple）
  return { address, township, landmark, intersection }
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
export type TransitLegKind = 'walk' | 'bus' | 'subway' | 'railway' | 'taxi'
export interface TransitLeg {
  kind: TransitLegKind
  line?: string           // 线路名（"1号线"/"300路"/车次），已去掉"(始发-终点)"括注
  fromStop?: string       // 上车站
  toStop?: string         // 下车站
  stops?: number          // 乘坐站数（含到站）
  entrance?: string       // 地铁进站口名（如"A口"）——盲人从哪个口进站，站口相距远、走错极难折返
  exit?: string           // 地铁出站口名（如"D口"）——从哪个口出站，同上，是盲人过城的关键落地指令
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
    // 地铁进/出站口（高德按 segment 返回；空的用空对象占位）——盲人从哪个口进/出站是过城落地的关键指令，此前被整段丢弃。
    entrance?: { name?: string }
    exit?: { name?: string }
    railway?: { name?: string; trip?: string; distance?: string; time?: string; departure_stop?: Stop; arrival_stop?: Stop }
    // 出租车段（首末公里/跨城无公交覆盖时高德会给一段打车）——此前整段被丢弃，盲人拿到的路线漏了一截、走到某处无所适从。
    // 至少如实告知"这段建议打车"（distance/drivetime 尽力取，缺则只报"打车"）。
    taxi?: { distance?: string; drivetime?: string; duration?: string }
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
        // 进/出站口仅地铁有意义（公交无"站口"）；空对象/空名 → undefined，绝不报"从口进站"半句。
        entrance: isSubway ? (seg.entrance?.name ?? '').trim() || undefined : undefined,
        exit: isSubway ? (seg.exit?.name ?? '').trim() || undefined : undefined,
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
    // 出租车段：只在**有真实距离**时算作一段（高德给所有键留空对象占位，taxi:{} 不能误当一段）。distance 是高德各段
    // 通用字段（近乎必有）；时长取 drivetime（打车段专有）或 duration 兜底。缺距离即不成段，绝不臆造"打车0米"。
    const taxi = seg.taxi
    if (taxi && numOrZero(taxi.distance) > 0) {
      legs.push({ kind: 'taxi', distanceMeters: numOrZero(taxi.distance), durationSeconds: numOrZero(taxi.drivetime ?? taxi.duration) })
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
