import { describe, it, expect, vi, afterEach } from 'vitest'
import { composeProductName, extractAllergens, extractDietaryLabels, lookupProduct, parseNutriScore, parseNovaGroup, parseQuantity } from '../src/product/openFoodFacts'
import { buildApp } from '../src/app'
import { MemoryStore } from '../src/db/store'

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

  it('extractDietaryLabels：归并同义词到 canonical、只收膳食/宗教认证子集、剥前缀/去重/表外忽略', () => {
    expect(extractDietaryLabels(['en:gluten-free', 'en:vegan', 'en:halal'])).toEqual(['gluten-free', 'vegan', 'halal'])
    expect(extractDietaryLabels(['en:no-gluten', 'en:no-lactose', 'en:no-added-sugar'])).toEqual(['gluten-free', 'lactose-free', 'sugar-free']) // 同义词归并到 canonical
    expect(extractDietaryLabels(['en:eu-organic', 'fr:organic'])).toEqual(['organic']) // 归并 + 去重（canonical 首现）
    expect(extractDietaryLabels(['en:green-dot', 'en:nutriscore', 'en:made-in-france'])).toEqual([]) // 表外噪声标签一律忽略（精度优先）
    expect(extractDietaryLabels(['en:VEGAN', '  ', 42, null, 'kosher'])).toEqual(['vegan', 'kosher']) // 大小写/坏项/无前缀
    expect(extractDietaryLabels('en:vegan')).toEqual([]) // 非数组 → 空
    expect(extractDietaryLabels(undefined)).toEqual([])
  })

  it('lookup 三态：found（含过敏原+微量标注）/notFound（未收录·无名）/failed（非200·异常）——区分瞬时故障与真未收录', async () => {
    const respond = (body: unknown) => async () => ({ ok: true, json: async () => body })
    // 声明含牛奶、可能含微量花生：allergens 与 traces **分开**提取，语义不同（确定含 vs 可能微量含）。
    expect(await lookupProduct('6901234567890', respond({ status: 1, product: { brands: '蒙牛', product_name: '纯牛奶', allergens_tags: ['en:milk'], traces_tags: ['en:peanuts', 'en:nuts'], nutriscore_grade: 'c', nova_group: 4, labels_tags: ['en:organic', 'en:halal'], quantity: '  500 ml ' } })))
      .toEqual({ kind: 'found', info: { name: '蒙牛 纯牛奶', allergens: ['milk'], traces: ['peanuts', 'nuts'], nutriScore: 'c', novaGroup: 4, dietaryLabels: ['organic', 'halal'], quantity: '500 ml' } })
    // 无 allergens_tags/traces_tags/labels_tags/quantity → 各空（缺数据≠不含；客户端只在非空时播"标注含有/可能含微量/标注/净含量"）；无营养分级 → null（不猜）。
    expect(await lookupProduct('6901234567890', respond({ status: 1, product: { brands: '蒙牛', product_name: '纯牛奶' } })))
      .toEqual({ kind: 'found', info: { name: '蒙牛 纯牛奶', allergens: [], traces: [], nutriScore: null, novaGroup: null, dietaryLabels: [], quantity: '' } })
    // status 0（明确未收录）与"有记录但无名"→ notFound（路由可长缓存）。
    expect(await lookupProduct('0000000000000', respond({ status: 0 }))).toEqual({ kind: 'notFound' })
    expect(await lookupProduct('6901234567890', respond({ status: 1, product: {} }))).toEqual({ kind: 'notFound' })
    // 非 200 与网络/超时异常 → failed（**瞬时故障，路由绝不长缓存**，复审#5/#10）。
    expect(await lookupProduct('6901234567890', async () => ({ ok: false, json: async () => ({}) }))).toEqual({ kind: 'failed' })
    expect(await lookupProduct('6901234567890', async () => { throw new Error('network') })).toEqual({ kind: 'failed' })
  })

  it('parseQuantity：去多余空白/截断/非字符串→空串；不解析单位（原样读）', () => {
    expect(parseQuantity('500 ml')).toBe('500 ml')
    expect(parseQuantity('  1 L  ')).toBe('1 L')          // 去首尾空白
    expect(parseQuantity('6 x  1.5   L')).toBe('6 x 1.5 L') // 多空白归一
    expect(parseQuantity('500毫升')).toBe('500毫升')       // 中文单位原样（不换算）
    expect(parseQuantity('x'.repeat(60)).length).toBe(40) // 截断防超长播报
    expect(parseQuantity(42)).toBe('')                    // 非字符串→空
    expect(parseQuantity(undefined)).toBe('')
  })

  it('parseNutriScore：只接受 a..e（大小写/空白归一）；unknown/not-applicable/其它→null（不猜）', () => {
    expect(parseNutriScore('a')).toBe('a')
    expect(parseNutriScore('E')).toBe('e')       // 大写归一
    expect(parseNutriScore(' d ')).toBe('d')     // 去空白
    expect(parseNutriScore('unknown')).toBeNull()
    expect(parseNutriScore('not-applicable')).toBeNull()
    expect(parseNutriScore('f')).toBeNull()
    expect(parseNutriScore(3)).toBeNull()
    expect(parseNutriScore(undefined)).toBeNull()
  })

  it('parseNovaGroup：只接受 1..4（数字或字符串）；越界/坏值→null', () => {
    expect(parseNovaGroup(1)).toBe(1)
    expect(parseNovaGroup(4)).toBe(4)
    expect(parseNovaGroup('3')).toBe(3)          // 字符串数字
    expect(parseNovaGroup(0)).toBeNull()
    expect(parseNovaGroup(5)).toBeNull()
    expect(parseNovaGroup(2.5)).toBeNull()       // 非整数
    expect(parseNovaGroup('x')).toBeNull()
    expect(parseNovaGroup(null)).toBeNull()
  })
})

describe('/api/product/:barcode 端点', () => {
  afterEach(() => vi.unstubAllGlobals())
  it('返回名+过敏原+营养分级(nutriScore/novaGroup)；命中缓存不重复回源', async () => {
    const app = buildApp(new MemoryStore())
    const reg = (await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'produ', password: 'secret123', role: 'blind' } })).json()
    const auth = { authorization: `Bearer ${reg.token}` }
    let calls = 0
    const body = { status: 1, product: { brands: '蒙牛', product_name: '纯牛奶', allergens_tags: ['en:milk'], traces_tags: ['en:nuts'], nutriscore_grade: 'c', nova_group: 4, labels_tags: ['en:no-lactose', 'en:halal'], quantity: '250 ml' } }
    vi.stubGlobal('fetch', vi.fn(async () => { calls++; return { ok: true, json: async () => body } }))
    const r1 = await app.inject({ method: 'GET', url: '/api/product/6901234567890', headers: auth })
    expect(r1.statusCode).toBe(200)
    expect(r1.json()).toMatchObject({ name: '蒙牛 纯牛奶', allergens: ['milk'], traces: ['nuts'], nutriScore: 'c', novaGroup: 4, dietaryLabels: ['lactose-free', 'halal'], quantity: '250 ml' })
    // 缓存命中：第二次不回源，过敏原/微量标注/营养分级/膳食标注/净含量仍在（缓存也存了新字段）。
    const r2 = await app.inject({ method: 'GET', url: '/api/product/6901234567890', headers: auth })
    expect(r2.json().traces).toEqual(['nuts']); expect(r2.json().nutriScore).toBe('c'); expect(r2.json().novaGroup).toBe(4)
    expect(r2.json().dietaryLabels).toEqual(['lactose-free', 'halal']); expect(r2.json().quantity).toBe('250 ml')
    expect(calls).toBe(1) // 只回源一次
    await app.close()
  })

  it('无营养数据的商品：nutriScore/novaGroup 为 null（不猜）；非法条码 400', async () => {
    const app = buildApp(new MemoryStore())
    const reg = (await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'produ2', password: 'secret123', role: 'blind' } })).json()
    const auth = { authorization: `Bearer ${reg.token}` }
    const body2 = { status: 1, product: { product_name: '苏打饼干' } }
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => body2 })))
    const r = await app.inject({ method: 'GET', url: '/api/product/12345678', headers: auth })
    expect(r.json()).toMatchObject({ name: '苏打饼干', nutriScore: null, novaGroup: null })
    // 非法条码（含字母）→ 400，不回源。
    expect((await app.inject({ method: 'GET', url: '/api/product/abc', headers: auth })).statusCode).toBe(400)
    await app.close()
  })
})
