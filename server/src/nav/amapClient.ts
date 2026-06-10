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

/// 地址 → "经度,纬度"（GCJ-02）。
export async function amapGeocode(address: string): Promise<string | undefined> {
  const key = apiKey()
  if (!key) return undefined
  const url = `${AMAP_BASE}/geocode/geo?address=${encodeURIComponent(address)}&key=${key}`
  const res = await fetch(url)
  const data = (await res.json()) as { geocodes?: Array<{ location?: string }> }
  return data.geocodes?.[0]?.location
}

/// 步行路线（origin/destination 均为 "经度,纬度"）。返回逐步指令。
export async function amapWalking(origin: string, destination: string): Promise<WalkStep[]> {
  const key = apiKey()
  if (!key) return []
  const url = `${AMAP_BASE}/direction/walking?origin=${origin}&destination=${destination}&key=${key}`
  const res = await fetch(url)
  const data = (await res.json()) as {
    route?: { paths?: Array<{ steps?: Array<{ instruction?: string; distance?: string; polyline?: string }> }> }
  }
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
