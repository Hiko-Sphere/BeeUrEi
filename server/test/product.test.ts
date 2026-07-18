import { describe, it, expect, vi, afterEach } from 'vitest'
import { composeProductName, extractAllergens, extractDietaryLabels, extractNutrientLevels, lookupProduct, parseNutriScore, parseNovaGroup, parseQuantity, parseIngredients, parseEnergyKcal, parseNutrimentGrams, parseServingGrams } from '../src/product/openFoodFacts'
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

  it('名字含品牌但大小写不同 → 不重复前缀（OFF brands 常全大写，防盲人听到品牌念两遍）', () => {
    // 真实场景：brands 全大写、product_name 正常大小写——区分大小写会误判"不含"而重复拼品牌。
    expect(composeProductName({ brands: 'COCA-COLA', product_name: 'Coca-Cola Zero' })).toBe('Coca-Cola Zero')
    expect(composeProductName({ brands: 'Oreo', product_name: 'OREO Chocolate' })).toBe('OREO Chocolate') // 反向大小写亦然
    expect(composeProductName({ brands: 'nestlé', product_name: 'Nestlé KitKat' })).toBe('Nestlé KitKat')
    // 名字确实不含品牌 → 仍正常前缀（大小写无关不会误吞该拼的品牌）。
    expect(composeProductName({ brands: 'LAYS', product_name: 'Classic Chips' })).toBe('LAYS Classic Chips')
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
    expect(extractDietaryLabels(['en:no-gluten', 'en:no-lactose'])).toEqual(['gluten-free', 'lactose-free']) // 同义词归并到 canonical
    // "无糖"(sugar-free)与"无添加糖"(no-added-sugar)是**不同**声明、绝不合并——无添加糖仍可能含天然/果糖，
    // 并成"无糖"会误导糖尿病人（与 lactose-free/dairy-free 单列同理）。
    expect(extractDietaryLabels(['en:sugar-free', 'en:no-added-sugar'])).toEqual(['sugar-free', 'no-added-sugar'])
    expect(extractDietaryLabels(['en:no-sugar'])).toEqual(['sugar-free']) // no-sugar≈无糖，仍归 sugar-free
    // 无奶(dairy-free) 与 无乳糖(lactose-free) 是**不同** canonical（无奶=完全不含奶，牛奶过敏/纯素据此决策；无乳糖仅去乳糖仍可能含乳蛋白）：各自保留、绝不合并。
    expect(extractDietaryLabels(['en:dairy-free', 'en:lactose-free'])).toEqual(['dairy-free', 'lactose-free'])
    expect(extractDietaryLabels(['en:no-dairy', 'en:milk-free'])).toEqual(['dairy-free']) // no-dairy/milk-free 同义归并 + 去重
    expect(extractDietaryLabels(['en:eu-organic', 'fr:organic'])).toEqual(['organic']) // 归并 + 去重（canonical 首现）
    // 非转基因（中国食用油/大豆制品法定醒目标注，盲人刚需）+ 无防腐剂：多同义写法归并到 canonical。
    expect(extractDietaryLabels(['en:no-gmos', 'en:no-preservatives'])).toEqual(['no-gmo', 'no-preservatives'])
    expect(extractDietaryLabels(['en:non-gmo', 'en:gmo-free', 'en:without-gmos'])).toEqual(['no-gmo']) // 同义词归并 + 去重
    expect(extractDietaryLabels(['en:green-dot', 'en:nutriscore', 'en:made-in-france'])).toEqual([]) // 表外噪声标签一律忽略（精度优先）
    expect(extractDietaryLabels(['en:VEGAN', '  ', 42, null, 'kosher'])).toEqual(['vegan', 'kosher']) // 大小写/坏项/无前缀
    expect(extractDietaryLabels('en:vegan')).toEqual([]) // 非数组 → 空
    expect(extractDietaryLabels(undefined)).toEqual([])
  })

  it('lookup 三态：found（含过敏原+微量标注）/notFound（未收录·无名）/failed（非200·异常）——区分瞬时故障与真未收录', async () => {
    const respond = (body: unknown) => async () => ({ ok: true, json: async () => body })
    // 声明含牛奶、可能含微量花生：allergens 与 traces **分开**提取，语义不同（确定含 vs 可能微量含）。
    expect(await lookupProduct('6901234567890', respond({ status: 1, product: { brands: '蒙牛', product_name: '纯牛奶', allergens_tags: ['en:milk'], traces_tags: ['en:peanuts', 'en:nuts'], nutriscore_grade: 'c', nova_group: 4, labels_tags: ['en:organic', 'en:halal'], quantity: '  500 ml ', nutrient_levels: { sugars: 'high', salt: 'moderate', fat: 'low', energy: 'high' }, ingredients_text: '  生牛乳、白砂糖、\n食品添加剂（柠檬酸）  ', nutriments: { 'energy-kcal_100g': 54.4, 'energy-kj_100g': 228, 'carbohydrates_100g': 12.3, 'sugars_100g': '4.5', 'proteins_100g': 3, 'fat_100g': 3.6 }, serving_quantity: '250' } })))
      .toEqual({ kind: 'found', info: { name: '蒙牛 纯牛奶', allergens: ['milk'], traces: ['peanuts', 'nuts'], nutriScore: 'c', novaGroup: 4, dietaryLabels: ['organic', 'halal'], quantity: '500 ml', nutrientLevels: { sugars: 'high', salt: 'moderate', fat: 'low' }, ingredients: '生牛乳、白砂糖、 食品添加剂（柠檬酸）', energyKcal100g: 54, macros100g: { carbohydrates: 12.3, sugars: 4.5, protein: 3, fat: 3.6 }, servingGrams: 250 } }) // energy 非白名单 4 素 → 丢弃；配料表去空白折叠；热量取 kcal/100 四舍五入(54.4→54，kJ 忽略)；四大营养素克数：proteins 复数键→protein、糖数字串'4.5'→4.5
    // 无 allergens_tags/traces_tags/labels_tags/quantity/nutrient_levels/ingredients_text/nutriments → 各空（缺数据≠不含；客户端只在非空时播）；无营养分级/热量 → null（不猜）。
    expect(await lookupProduct('6901234567890', respond({ status: 1, product: { brands: '蒙牛', product_name: '纯牛奶' } })))
      .toEqual({ kind: 'found', info: { name: '蒙牛 纯牛奶', allergens: [], traces: [], nutriScore: null, novaGroup: null, dietaryLabels: [], quantity: '', nutrientLevels: {}, ingredients: '', energyKcal100g: null, macros100g: { carbohydrates: null, sugars: null, protein: null, fat: null }, servingGrams: null } }) // 无 nutriments → 四大营养素各独立 null；无 serving_quantity → servingGrams null
    // status 0（明确未收录）与"有记录但无名"→ notFound（路由可长缓存）。
    expect(await lookupProduct('0000000000000', respond({ status: 0 }))).toEqual({ kind: 'notFound' })
    expect(await lookupProduct('6901234567890', respond({ status: 1, product: {} }))).toEqual({ kind: 'notFound' })
    // 非 200 与网络/超时异常 → failed（**瞬时故障，路由绝不长缓存**，复审#5/#10）。
    expect(await lookupProduct('6901234567890', async () => ({ ok: false, json: async () => ({}) }))).toEqual({ kind: 'failed' })
    expect(await lookupProduct('6901234567890', async () => { throw new Error('network') })).toEqual({ kind: 'failed' })
  })

  it('extractNutrientLevels：只收白名单 4 素×3 档、大小写归一、丢弃越界键值/非对象', () => {
    expect(extractNutrientLevels({ fat: 'low', 'saturated-fat': 'high', sugars: 'high', salt: 'moderate' }))
      .toEqual({ fat: 'low', 'saturated-fat': 'high', sugars: 'high', salt: 'moderate' })
    expect(extractNutrientLevels({ SUGARS: 'HIGH', Salt: ' moderate ' })).toEqual({ sugars: 'high', salt: 'moderate' }) // 键值大小写/空白归一
    expect(extractNutrientLevels({ energy: 'high', sugars: 'extreme', fat: 42, salt: 'high' })).toEqual({ salt: 'high' }) // 越界键(energy)/越界档(extreme)/非字符串(42)全丢
    expect(extractNutrientLevels({})).toEqual({})
    expect(extractNutrientLevels(['sugars'])).toEqual({}) // 数组→空
    expect(extractNutrientLevels(null)).toEqual({})
    expect(extractNutrientLevels('sugars:high')).toEqual({})
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

  it('parseIngredients：去空白/折叠换行/超长截 200+…/非字符串→空串（原文读，不解析成分）', () => {
    expect(parseIngredients('  生牛乳、白砂糖  ')).toBe('生牛乳、白砂糖')     // 去首尾空白
    expect(parseIngredients('水、\n 白砂糖、\t食盐')).toBe('水、 白砂糖、 食盐') // 换行/制表折叠为单空格
    expect(parseIngredients('')).toBe('')                                    // 空
    expect(parseIngredients('   ')).toBe('')                                 // 纯空白→空（非" …"）
    const long = parseIngredients('料'.repeat(300))
    expect(long.length).toBe(201); expect(long.endsWith('…')).toBe(true)     // 截到 200 字 + 省略号
    expect(parseIngredients(['water'])).toBe('')                             // 非字符串→空
    expect(parseIngredients(undefined)).toBe('')
  })

  it('parseEnergyKcal：数字/数字串取整；非有限/负/缺→null；夹上限', () => {
    expect(parseEnergyKcal(54.4)).toBe(54)          // 四舍五入
    expect(parseEnergyKcal(54.6)).toBe(55)
    expect(parseEnergyKcal('250')).toBe(250)        // 数字字符串
    expect(parseEnergyKcal(' 89.5 ')).toBe(90)      // 带空白的数字串
    expect(parseEnergyKcal(0)).toBe(0)              // 真 0 千卡（如水）照常保留
    expect(parseEnergyKcal(-5)).toBeNull()          // 负值（异常）→ null
    expect(parseEnergyKcal(NaN)).toBeNull()
    expect(parseEnergyKcal('abc')).toBeNull()       // 非数字串→null
    expect(parseEnergyKcal(undefined)).toBeNull()   // 缺→null
    expect(parseEnergyKcal(1e9)).toBe(100_000)      // 异常巨值夹到上限
  })

  it('parseNutrimentGrams：数字/数字串保留 1 位小数；非有限/负/缺→null；夹上限 1000', () => {
    expect(parseNutrimentGrams(12.34)).toBe(12.3)     // 保留 1 位小数（四舍五入到 0.1）
    expect(parseNutrimentGrams(4.85)).toBe(4.9)       // 进位到 4.9（克数计量需这点精度）
    expect(parseNutrimentGrams('3')).toBe(3)          // 数字字符串
    expect(parseNutrimentGrams(' 7.25 ')).toBe(7.3)   // 带空白的数字串 + 进位
    expect(parseNutrimentGrams(0)).toBe(0)            // 真 0 克（如纯水的糖/脂）照常保留
    expect(parseNutrimentGrams(-1)).toBeNull()        // 负值（异常）→ null
    expect(parseNutrimentGrams(NaN)).toBeNull()
    expect(parseNutrimentGrams('abc')).toBeNull()     // 非数字串→null
    expect(parseNutrimentGrams(undefined)).toBeNull() // 缺→null（不猜、独立于其它素）
    expect(parseNutrimentGrams(99999)).toBe(1000)     // 脏数据天文值夹到上限 1000
  })

  it('parseServingGrams：数字/数字串保留 1 位小数；**≤0**/非有限/缺→null；夹上限 5000', () => {
    expect(parseServingGrams(30)).toBe(30)            // 每份 30 克
    expect(parseServingGrams('250')).toBe(250)        // 数字字符串（OFF 常给字符串）
    expect(parseServingGrams(33.33)).toBe(33.3)       // 保留 1 位小数
    expect(parseServingGrams(0)).toBeNull()           // 一份 0 克无意义 → null（区别于 parseNutrimentGrams 保留 0）
    expect(parseServingGrams(-5)).toBeNull()          // 负 → null
    expect(parseServingGrams(NaN)).toBeNull()
    expect(parseServingGrams('abc')).toBeNull()       // 非数字串 → null
    expect(parseServingGrams(undefined)).toBeNull()   // 缺 → null
    expect(parseServingGrams(999999)).toBe(5000)      // 脏数据天文值夹到上限 5000
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
    const body = { status: 1, product: { brands: '蒙牛', product_name: '纯牛奶', allergens_tags: ['en:milk'], traces_tags: ['en:nuts'], nutriscore_grade: 'c', nova_group: 4, labels_tags: ['en:no-lactose', 'en:halal'], quantity: '250 ml', nutriments: { 'carbohydrates_100g': 5, 'sugars_100g': 4.8, 'proteins_100g': 3.2, 'fat_100g': 3.9 } } }
    vi.stubGlobal('fetch', vi.fn(async () => { calls++; return { ok: true, json: async () => body } }))
    const r1 = await app.inject({ method: 'GET', url: '/api/product/6901234567890', headers: auth })
    expect(r1.statusCode).toBe(200)
    expect(r1.json()).toMatchObject({ name: '蒙牛 纯牛奶', allergens: ['milk'], traces: ['nuts'], nutriScore: 'c', novaGroup: 4, dietaryLabels: ['lactose-free', 'halal'], quantity: '250 ml', macros100g: { carbohydrates: 5, sugars: 4.8, protein: 3.2, fat: 3.9 } })
    // 缓存命中：第二次不回源，过敏原/微量标注/营养分级/膳食标注/净含量/四大营养素克数仍在（缓存也存了新字段）。
    const r2 = await app.inject({ method: 'GET', url: '/api/product/6901234567890', headers: auth })
    expect(r2.json().traces).toEqual(['nuts']); expect(r2.json().nutriScore).toBe('c'); expect(r2.json().novaGroup).toBe(4)
    expect(r2.json().dietaryLabels).toEqual(['lactose-free', 'halal']); expect(r2.json().quantity).toBe('250 ml')
    expect(r2.json().macros100g).toEqual({ carbohydrates: 5, sugars: 4.8, protein: 3.2, fat: 3.9 }) // 克数经缓存原样返回
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
