import { describe, it, expect } from 'vitest'
import { composeProductName, extractAllergens, lookupProduct } from '../src/product/openFoodFacts'

describe('Open Food Facts 商品查询', () => {
  it('组名：品牌+商品名；多品牌取首；名字已含品牌不重复；均空→null', () => {
    expect(composeProductName({ brands: '蒙牛', product_name: '纯牛奶' })).toBe('蒙牛 纯牛奶')
    expect(composeProductName({ brands: '蒙牛,Mengniu', product_name: '纯牛奶' })).toBe('蒙牛 纯牛奶') // 多品牌取首个
    expect(composeProductName({ brands: '蒙牛', product_name: '蒙牛纯牛奶' })).toBe('蒙牛纯牛奶')       // 不重复前缀
    expect(composeProductName({ product_name: '苏打饼干' })).toBe('苏打饼干')                          // 只有名字
    expect(composeProductName({ brands: 'Oreo' })).toBe('Oreo')                                        // 只有品牌
    expect(composeProductName({ brands: '', product_name: '' })).toBeNull()
    expect(composeProductName(null)).toBeNull()
    expect(composeProductName('nonsense')).toBeNull()
  })

  it('组名截断超长到 120 字', () => {
    const long = 'x'.repeat(300)
    expect(composeProductName({ product_name: long })!.length).toBe(120)
  })

  it('extractAllergens：剥语言前缀/去重/去空/上限/坏数据安全', () => {
    expect(extractAllergens(['en:peanuts', 'en:milk'])).toEqual(['peanuts', 'milk'])
    expect(extractAllergens(['fr:lait', 'en:milk', 'en:MILK'])).toEqual(['lait', 'milk']) // 前缀不限 en:；大小写去重
    expect(extractAllergens(['en:', '  ', 42, null, 'soybeans'])).toEqual(['soybeans'])   // 空/坏项跳过；无前缀也认
    expect(extractAllergens('en:peanuts')).toEqual([])                                    // 非数组→空
    expect(extractAllergens(undefined)).toEqual([])
    expect(extractAllergens(Array.from({ length: 30 }, (_, i) => `en:a${i}`)).length).toBe(16) // 上限防脏数据刷屏
  })

  it('lookup 三态：found（含过敏原）/notFound（未收录·无名）/failed（非200·异常）——区分瞬时故障与真未收录', async () => {
    const respond = (body: unknown) => async () => ({ ok: true, json: async () => body })
    expect(await lookupProduct('6901234567890', respond({ status: 1, product: { brands: '蒙牛', product_name: '纯牛奶', allergens_tags: ['en:milk'] } })))
      .toEqual({ kind: 'found', info: { name: '蒙牛 纯牛奶', allergens: ['milk'] } })
    // 无 allergens_tags → 空数组（缺数据≠不含；客户端只在非空时播"标注含有"）。
    expect(await lookupProduct('6901234567890', respond({ status: 1, product: { brands: '蒙牛', product_name: '纯牛奶' } })))
      .toEqual({ kind: 'found', info: { name: '蒙牛 纯牛奶', allergens: [] } })
    // status 0（明确未收录）与"有记录但无名"→ notFound（路由可长缓存）。
    expect(await lookupProduct('0000000000000', respond({ status: 0 }))).toEqual({ kind: 'notFound' })
    expect(await lookupProduct('6901234567890', respond({ status: 1, product: {} }))).toEqual({ kind: 'notFound' })
    // 非 200 与网络/超时异常 → failed（**瞬时故障，路由绝不长缓存**，复审#5/#10）。
    expect(await lookupProduct('6901234567890', async () => ({ ok: false, json: async () => ({}) }))).toEqual({ kind: 'failed' })
    expect(await lookupProduct('6901234567890', async () => { throw new Error('network') })).toEqual({ kind: 'failed' })
  })
})
