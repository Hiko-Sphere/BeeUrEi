import { describe, it, expect } from 'vitest'
import { parseLocation, appleMapsUrl, appleMapsDirectionsUrl, haversineMeters, routeDistanceMeters, routeDistanceText, routeWalkingMinutes, routeWalkingText, locationMessageText, validLatLng } from './location'

const zh = (a: string) => a // t 桩：取中文
const en = (_a: string, b: string) => b // t 桩：取英文

describe('haversineMeters / routeDistanceMeters', () => {
  it('两点距离与已知值吻合（~111km/纬度差 1°）', () => {
    const d = haversineMeters(0, 0, 1, 0) // 沿经线 1° ≈ 111.19 km
    expect(d).toBeGreaterThan(111_000)
    expect(d).toBeLessThan(111_400)
  })
  it('同点=0；非有限坐标→0（不 NaN 污染总和）', () => {
    expect(haversineMeters(31.2, 121.4, 31.2, 121.4)).toBe(0)
    expect(haversineMeters(NaN, 0, 1, 0)).toBe(0)
    expect(haversineMeters(0, 0, Infinity, 0)).toBe(0)
  })
  it('路线总长=相邻段之和；<2 点为 0', () => {
    expect(routeDistanceMeters([])).toBe(0)
    expect(routeDistanceMeters([{ lat: 0, lng: 0 }])).toBe(0)
    const total = routeDistanceMeters([{ lat: 0, lng: 0 }, { lat: 0, lng: 1 }, { lat: 0, lng: 2 }])
    const seg = haversineMeters(0, 0, 0, 1)
    expect(total).toBeCloseTo(seg * 2, 0) // 两段等长
  })
})

describe('routeDistanceText', () => {
  it('<1km 用整米；≥1km 用公里(0.1 精度去尾零)', () => {
    expect(routeDistanceText(0, zh)).toBe('约 0 米')
    expect(routeDistanceText(850, zh)).toBe('约 850 米')
    expect(routeDistanceText(999, zh)).toBe('约 999 米')
    expect(routeDistanceText(1000, zh)).toBe('约 1 公里')
    expect(routeDistanceText(1250, zh)).toBe('约 1.3 公里') // 1250→12.5→四舍五入 13→1.3
    expect(routeDistanceText(2000, zh)).toBe('约 2 公里')   // 去尾零 2.0→2
  })
  it('非有限/负→约 0 米（不崩不 NaN）', () => {
    expect(routeDistanceText(NaN, zh)).toBe('约 0 米')
    expect(routeDistanceText(-5, zh)).toBe('约 0 米')
  })
  it('英制单位（英尺/英里，与 iOS 距离单位设置对齐）', () => {
    expect(routeDistanceText(200, en, 'imperial')).toBe('~656 ft')   // 200m≈656ft
    expect(routeDistanceText(1200, en, 'imperial')).toBe('~0.7 mi')  // 1200m≈0.7mi
    expect(routeDistanceText(1200, zh, 'imperial')).toBe('约 0.7 英里')
    // 公制默认（不传 unit）逐字不变，回归守卫。
    expect(routeDistanceText(1200, zh)).toBe('约 1.2 公里')
  })
})

describe('routeWalking* 步行时间估计（步速 1.2 m/s，与 iOS RouteRemaining 默认同口径）', () => {
  it('分钟数=距离/步速向上取整，最少 1 分钟', () => {
    expect(routeWalkingMinutes(1200)).toBe(17)  // 1200/1.2/60=16.7→17
    expect(routeWalkingMinutes(72)).toBe(1)      // 恰 1 分钟
    expect(routeWalkingMinutes(30)).toBe(1)      // 0.4 分钟也报 1（不报 0）
    expect(routeWalkingMinutes(0)).toBe(0)       // 无距离→0
    expect(routeWalkingMinutes(NaN)).toBe(0)
    expect(routeWalkingMinutes(-5)).toBe(0)
  })
  it('<60 分钟用分钟；≥60 用小时[+分钟]；0 距离→空串（不显示"约 0 分钟"）', () => {
    expect(routeWalkingText(1200, zh)).toBe('步行约 17 分钟')
    expect(routeWalkingText(1200, en)).toBe('~17 min walk')
    expect(routeWalkingText(4320, zh)).toBe('步行约 1 小时')        // 恰 60 分钟，分钟位省略
    expect(routeWalkingText(4680, zh)).toBe('步行约 1 小时 5 分钟')  // 65 分钟
    expect(routeWalkingText(4680, en)).toBe('~1 h 5 min walk')
    expect(routeWalkingText(0, zh)).toBe('')                        // 空串→调用方省略
    expect(routeWalkingText(NaN, zh)).toBe('')
  })
})

describe('appleMapsUrl', () => {
  it('有 label：编码作查询名；坐标为 WGS-84 原样', () => {
    expect(appleMapsUrl(31.23, 121.47, '阿明')).toBe(`https://maps.apple.com/?ll=31.23,121.47&q=${encodeURIComponent('阿明')}`)
  })
  it('无 label / 空白 label：用"经,纬"当查询名（不编码，与紧急告警/通知一致）', () => {
    expect(appleMapsUrl(31.23, 121.47)).toBe('https://maps.apple.com/?ll=31.23,121.47&q=31.23,121.47')
    expect(appleMapsUrl(31.23, 121.47, '   ')).toBe('https://maps.apple.com/?ll=31.23,121.47&q=31.23,121.47')
  })
  it('label 含特殊字符：编码，绝不破坏 URL/HTML 属性', () => {
    const u = appleMapsUrl(1, 2, 'a&b "c" <x>')
    expect(u).toContain(`&q=${encodeURIComponent('a&b "c" <x>')}`)
    expect(u).not.toContain('"') // 编码后无裸引号，可安全放入 href="..."
    expect(u).not.toContain('<')
  })

  it('appleMapsDirectionsUrl：用 daddr（导航前往）而非 ll（落图钉）；label 同样编码', () => {
    // 导航链接=daddr（从当前位置起算的方向），区别于落图钉的 ll。
    expect(appleMapsDirectionsUrl(31.23, 121.47, '阿明')).toBe(`https://maps.apple.com/?daddr=31.23,121.47&q=${encodeURIComponent('阿明')}`)
    expect(appleMapsDirectionsUrl(31.23, 121.47)).toBe('https://maps.apple.com/?daddr=31.23,121.47&q=31.23,121.47')
    // 特殊字符编码，不破 href 属性。
    const u = appleMapsDirectionsUrl(1, 2, 'a&b "c" <x>')
    expect(u).toContain('daddr=1,2')
    expect(u).not.toContain('"')
    expect(u).not.toContain('<')
  })
})

describe('validLatLng 坐标可作地图链接的校验（渲染可选/外来坐标成地图链接前的守卫）', () => {
  it('有限且在范围内 → 规整后的 {lat,lng}', () => {
    expect(validLatLng(31.23, 121.47)).toEqual({ lat: 31.23, lng: 121.47 })
    expect(validLatLng(0, 0)).toEqual({ lat: 0, lng: 0 })      // 赤道/本初子午线是合法坐标（非"空"）
    expect(validLatLng(-90, -180)).toEqual({ lat: -90, lng: -180 }) // 边界含
    expect(validLatLng(90, 180)).toEqual({ lat: 90, lng: 180 })
  })
  it('null/undefined（服务端可选字段常见）→ null', () => {
    expect(validLatLng(null, 121)).toBeNull()
    expect(validLatLng(31, null)).toBeNull()
    expect(validLatLng(undefined, undefined)).toBeNull()
    expect(validLatLng(null, null)).toBeNull()
  })
  it('越界/非有限 → null（绝不拼出 NaN/越界的坏地图链接）', () => {
    expect(validLatLng(91, 0)).toBeNull()     // 纬度越界
    expect(validLatLng(-90.1, 0)).toBeNull()
    expect(validLatLng(0, 181)).toBeNull()    // 经度越界
    expect(validLatLng(0, -180.5)).toBeNull()
    expect(validLatLng(NaN, 0)).toBeNull()
    expect(validLatLng(0, Infinity)).toBeNull()
  })
})

describe('parseLocation', () => {
  it('JSON 形态：合法经纬度 + 可选 name', () => {
    expect(parseLocation('{"lat":31.23,"lng":121.47,"name":"上海"}')).toEqual({ lat: 31.23, lng: 121.47, name: '上海' })
    expect(parseLocation('{"lat":0,"lng":0}')).toEqual({ lat: 0, lng: 0, name: undefined })
  })

  it('文本链接形态：内嵌 maps.apple.com 链接（含前后文字）', () => {
    const r = parseLocation('我在这 https://maps.apple.com/?ll=31.2,121.4&q=家 快来')
    expect(r).toEqual({ lat: 31.2, lng: 121.4, name: '家' })
  })

  it('越界/非有限/缺字段一律 null（不抛错）', () => {
    expect(parseLocation('{"lat":91,"lng":0}')).toBeNull()       // 纬度越界
    expect(parseLocation('{"lat":0,"lng":181}')).toBeNull()      // 经度越界
    expect(parseLocation('{"lat":"x","lng":0}')).toBeNull()      // 类型错
    expect(parseLocation('{"lat":0}')).toBeNull()                // 缺 lng
    expect(parseLocation('https://maps.apple.com/?ll=999,0')).toBeNull() // 链接里越界
    expect(parseLocation('https://maps.apple.com/?ll=abc,def')).toBeNull() // 非数字
  })

  it('普通文本/空串 → null（不当成位置）', () => {
    expect(parseLocation('就是一条普通消息')).toBeNull()
    expect(parseLocation('')).toBeNull()
    expect(parseLocation('{乱七八糟')).toBeNull()
  })

  it('null/undefined 输入 → null 而非抛错（契约：绝不抛错）', () => {
    // 后端数据异常时消息 text 可能为 null/undefined；文本链接分支在 try 外，无守卫会抛 TypeError 连累渲染。
    expect(() => parseLocation(undefined as unknown as string)).not.toThrow()
    expect(() => parseLocation(null as unknown as string)).not.toThrow()
    expect(parseLocation(undefined as unknown as string)).toBeNull()
    expect(parseLocation(null as unknown as string)).toBeNull()
  })
})

describe('locationMessageText（发送我的位置：与 iOS asText 同口径，可被 parseLocation 还原）', () => {
  it('生成 📍 + 6 位小数 Apple 地图链接；能被自家 parseLocation 往返还原', () => {
    const txt = locationMessageText(31.230416, 121.473701)
    expect(txt).toBe('📍\nhttps://maps.apple.com/?ll=31.230416,121.473701')
    // 往返：发出去的文本，两端 parseLocation 都能还原成同一坐标（跨端渲染一致的保证）。
    const parsed = parseLocation(txt!)
    expect(parsed?.lat).toBeCloseTo(31.230416, 6)
    expect(parsed?.lng).toBeCloseTo(121.473701, 6)
  })
  it('6 位小数补零（与 iOS %.6f 对齐）；整数坐标也带 6 位', () => {
    expect(locationMessageText(0, 0)).toBe('📍\nhttps://maps.apple.com/?ll=0.000000,0.000000')
    expect(locationMessageText(-1.5, 100)).toBe('📍\nhttps://maps.apple.com/?ll=-1.500000,100.000000')
  })
  it('非有限/越界坐标 → null（不发假位置）', () => {
    expect(locationMessageText(Number.NaN, 0)).toBeNull()
    expect(locationMessageText(0, Infinity)).toBeNull()
    expect(locationMessageText(91, 0)).toBeNull()
    expect(locationMessageText(0, 181)).toBeNull()
  })
})
