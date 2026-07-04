/// WGS-84 ↔ GCJ-02 坐标纠偏（TS 端口，与 iOS BeeUrEiCore/ChinaCoord.swift 同算法）。
/// 用途：高德地理编码(amapGeocode)返回 GCJ-02，而全栈存 WGS-84——保存"家/公司"坐标供围栏判定时须转回 WGS-84，
/// 与客户端上报的 WGS-84 实时位置同系比较。境外坐标原样返回（GCJ 偏移仅大陆生效）。

const A = 6378245.0                // 克拉索夫斯基椭球长半轴
const EE = 0.00669342162296594323 // 偏心率平方

/// 粗判大陆范围（GCJ 偏移仅境内生效；港澳台/境外不偏移）。
export function isInChina(lat: number, lon: number): boolean {
  return lon >= 72.004 && lon <= 137.8347 && lat >= 0.8293 && lat <= 55.8271
}

function transformLat(x: number, y: number): number {
  let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x))
  ret += ((20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0) / 3.0
  ret += ((20.0 * Math.sin(y * Math.PI) + 40.0 * Math.sin((y / 3.0) * Math.PI)) * 2.0) / 3.0
  ret += ((160.0 * Math.sin((y / 12.0) * Math.PI) + 320 * Math.sin((y * Math.PI) / 30.0)) * 2.0) / 3.0
  return ret
}

function transformLon(x: number, y: number): number {
  let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x))
  ret += ((20.0 * Math.sin(6.0 * x * Math.PI) + 20.0 * Math.sin(2.0 * x * Math.PI)) * 2.0) / 3.0
  ret += ((20.0 * Math.sin(x * Math.PI) + 40.0 * Math.sin((x / 3.0) * Math.PI)) * 2.0) / 3.0
  ret += ((150.0 * Math.sin((x / 12.0) * Math.PI) + 300.0 * Math.sin((x / 30.0) * Math.PI)) * 2.0) / 3.0
  return ret
}

function delta(lat: number, lon: number): { dLat: number; dLon: number } {
  const dLat0 = transformLat(lon - 105.0, lat - 35.0)
  const dLon0 = transformLon(lon - 105.0, lat - 35.0)
  const radLat = (lat / 180.0) * Math.PI
  let magic = Math.sin(radLat)
  magic = 1 - EE * magic * magic
  const sqrtMagic = Math.sqrt(magic)
  const dLat = (dLat0 * 180.0) / (((A * (1 - EE)) / (magic * sqrtMagic)) * Math.PI)
  const dLon = (dLon0 * 180.0) / ((A / sqrtMagic) * Math.cos(radLat) * Math.PI)
  return { dLat, dLon }
}

/// WGS-84 → GCJ-02。
export function wgs84ToGcj02(lat: number, lon: number): { lat: number; lon: number } {
  if (!isInChina(lat, lon)) return { lat, lon }
  const { dLat, dLon } = delta(lat, lon)
  return { lat: lat + dLat, lon: lon + dLon }
}

/// GCJ-02 → WGS-84（两次迭代逆变换，误差降到厘米级）。
export function gcj02ToWgs84(lat: number, lon: number): { lat: number; lon: number } {
  if (!isInChina(lat, lon)) return { lat, lon }
  let wLat = lat
  let wLon = lon
  for (let i = 0; i < 2; i++) {
    const g = wgs84ToGcj02(wLat, wLon)
    wLat -= g.lat - lat
    wLon -= g.lon - lon
  }
  return { lat: wLat, lon: wLon }
}
