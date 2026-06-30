import { describe, it, expect } from 'vitest'
import { parseLocation } from './location'

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
})
