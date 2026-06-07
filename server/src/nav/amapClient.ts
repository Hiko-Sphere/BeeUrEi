/// 高德 Web 服务客户端（国内步行导航）。Key 从环境变量读取（.env，仅后端持有，不进 App）。
const AMAP_BASE = 'https://restapi.amap.com/v3'

export interface WalkStep {
  instruction: string
  distanceMeters: number
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
    route?: { paths?: Array<{ steps?: Array<{ instruction?: string; distance?: string }> }> }
  }
  const steps = data.route?.paths?.[0]?.steps ?? []
  return steps.map((s) => ({ instruction: s.instruction ?? '', distanceMeters: Number(s.distance ?? 0) }))
}
