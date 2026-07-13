/// Open Food Facts 商品条码查询（免密钥、公开数据库）：EAN/UPC → 商品名。盲人在店里扫到没起过名的商品时，
/// 先在线查一次直接报出品牌+名字（对标 Seeing AI「产品」频道），查不到再回退让用户自己起名——绝不编造。
/// 解析/组名是纯逻辑（可单测）；网络由注入的 fetchImpl 提供（生产用全局 fetch，测试传桩）。

export interface ProductInfo {
  name: string
  /// 包装**标注**的过敏原（OFF allergens_tags 规范化标签去掉 "en:" 前缀，如 "peanuts"/"milk"）。
  /// 只在有标注时给出；空数组=无数据——**缺数据≠不含过敏原**，客户端只能播"标注含有X"、绝不能播"不含"。
  allergens: string[]
  /// 包装标注的**微量/交叉污染**过敏原（OFF traces_tags，"may contain traces of X"）。与 allergens 语义**不同**：
  /// 这是"可能含微量"而非"确定含有"，须分开措辞。对严重过敏（可致过敏性休克）的盲人是刚需——包装上读不到。
  /// 空数组=无该项数据（同样**缺数据≠不含**）。
  traces: string[]
  /// 营养分级 Nutri-Score（'a'..'e'，a 最优 e 最差）。盲人读不到营养标签，这是可听的整体营养质量。
  /// 无数据/不适用（如水/酒）→ null；只给可信的 a..e，绝不猜。
  nutriScore?: string | null
  /// 加工程度 NOVA 组（1=未/微加工 … 4=超加工）。"超加工食品"是可听的健康提示。无数据→ null。
  novaGroup?: number | null
  /// 包装**标注**的膳食/宗教认证（OFF labels_tags 里与饮食合规相关的规范化子集：无麸质/无乳糖/纯素/素食/清真/
  /// 洁食/有机/无糖/不含棕榈油/非转基因/无防腐剂）。盲人看不到包装上的这些认证，而这正是刚需——乳糜泻(无麸质)、乳糖不耐、
  /// 素食/纯素、清真/洁食(宗教)、糖尿病(无糖)、非转基因(食用油/大豆)。**是厂商标注的认证**（多为法规监管），措辞用"标注"如实转述、不替用户判定。
  /// 空数组=无该项标注数据（同过敏原：**缺数据≠不含/不符**）。
  dietaryLabels: string[]
  /// 净含量/规格文本（OFF quantity，如 "500 ml"/"200 g"/"1 L"）。盲人看不到包装规格，而它决定份量与选对大小
  /// （330ml vs 1.5L、大小罐/盒难靠手感区分）——对标 Seeing AI 产品频道读规格。**原样读**、不做单位换算/解析
  /// （自由文本、各国写法不一，原样最不失真）。空串=无数据。
  quantity: string
  /// 逐营养素含量档（OFF nutrient_levels：fat/saturated-fat/sugars/salt → low|moderate|high）。盲人读不到
  /// 营养表，而"糖/盐/脂肪偏高"是**可听的、可据以决策**的健康提示——对标 Yuka / Open Food Facts 的红黄绿标。
  /// 只收白名单 4 素 × 3 档，其它一律丢弃。空对象=无数据（客户端只在有档时播，且只警示 high、不播"不高"避免假安心）。
  nutrientLevels: Record<string, string>
}

type FetchLike = (url: string, init?: unknown) => Promise<{ ok: boolean; json: () => Promise<unknown> }>

/// 从 Open Food Facts 商品对象组一个可读名："品牌 商品名"。多品牌取首个；商品名已含品牌则不重复前缀；
/// 均为空返回 null（上层据此回退"用户起名"）。截断防超长播报。
export function composeProductName(product: unknown): string | null {
  if (!product || typeof product !== 'object') return null
  const p = product as Record<string, unknown>
  const brandRaw = typeof p.brands === 'string' ? p.brands : ''
  const brand = (brandRaw.split(',')[0] ?? '').trim()
  const name = typeof p.product_name === 'string' ? p.product_name.trim() : ''
  // 名字已含品牌则不重复前缀——**大小写不敏感**比对：OFF 的 brands 常与 product_name 大小写不一致
  // （brands 多为全大写，如 brands="COCA-COLA" / product_name="Coca-Cola Zero"）。区分大小写会判为"不含"、
  // 于是把品牌又拼一遍 → 盲人听到"COCA-COLA Coca-Cola Zero"（同一品牌念两遍）。转小写比对消除该重复。
  const full = brand && name
    ? (name.toLowerCase().includes(brand.toLowerCase()) ? name : `${brand} ${name}`)
    : (name || brand)
  const trimmed = full.trim()
  return trimmed ? trimmed.slice(0, 120) : null
}

/// 从 OFF allergens_tags 提取规范化过敏原词（["en:peanuts","en:milk"] → ["peanuts","milk"]）。
/// 语言前缀不限 "en:"（法语条目可能是 "fr:xxx"）；去重保序、去空、上限 16 防脏数据刷屏；非数组/坏项一律跳过。
export function extractAllergens(tags: unknown): string[] {
  if (!Array.isArray(tags)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const t of tags) {
    if (typeof t !== 'string') continue
    const word = t.includes(':') ? t.slice(t.indexOf(':') + 1).trim() : t.trim()
    const key = word.toLowerCase()
    if (!key || seen.has(key)) continue
    seen.add(key)
    out.push(key)
    if (out.length >= 16) break
  }
  return out
}

/// OFF labels_tags → 膳食/宗教认证的**规范化子集**（同义词归并到一个 canonical key）。只收与盲人饮食合规
/// 直接相关的项，噪声标签（如"绿色圆点""促销"）一律忽略——精度优先，避免把无关标签念成"认证"。
const DIETARY_LABEL_MAP: Record<string, string> = {
  'gluten-free': 'gluten-free', 'no-gluten': 'gluten-free',
  'lactose-free': 'lactose-free', 'no-lactose': 'lactose-free',
  'vegan': 'vegan',
  'vegetarian': 'vegetarian',
  'halal': 'halal',
  'kosher': 'kosher',
  'organic': 'organic', 'eu-organic': 'organic',
  'sugar-free': 'sugar-free', 'no-sugar': 'sugar-free', 'no-added-sugar': 'sugar-free',
  'palm-oil-free': 'palm-oil-free', 'no-palm-oil': 'palm-oil-free',
  // 非转基因：中国食用油/大豆/玉米制品最醒目的法定标注（转基因/非转基因是购买决策关键），盲人看不到，刚需。
  'no-gmos': 'no-gmo', 'no-gmo': 'no-gmo', 'non-gmo': 'no-gmo', 'without-gmos': 'no-gmo', 'gmo-free': 'no-gmo',
  // 无防腐剂：常见健康诉求标注（对防腐剂敏感/追求少添加者的购买依据）。
  'no-preservatives': 'no-preservatives', 'without-preservatives': 'no-preservatives',
}

/// 从 OFF labels_tags 提取规范化膳食标签（["en:organic","en:gluten-free","fr:bio"] → ["organic","gluten-free"]）。
/// 语言前缀不限；按 DIETARY_LABEL_MAP 归并同义词、去重（保 canonical 首现序）；表外标签一律跳过（精度优先）。
export function extractDietaryLabels(tags: unknown): string[] {
  if (!Array.isArray(tags)) return []
  const out: string[] = []
  const seen = new Set<string>()
  for (const t of tags) {
    if (typeof t !== 'string') continue
    const word = (t.includes(':') ? t.slice(t.indexOf(':') + 1) : t).trim().toLowerCase()
    const canon = DIETARY_LABEL_MAP[word]
    if (!canon || seen.has(canon)) continue
    seen.add(canon)
    out.push(canon)
  }
  return out
}

/// 净含量文本（OFF quantity 自由文本，如 "500 ml"/"200 g"）：去多余空白、截断防超长；非字符串/空→空串。
/// **不做单位换算/解析**——各国写法不一（"500ml"/"500 mL"/"1L"/"6 x 1.5 L"/"500毫升"），原样读最不失真。
export function parseQuantity(v: unknown): string {
  return typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, 40) : ''
}

/// Nutri-Score 分级：只接受可信的 a..e（OFF 用小写；'unknown'/'not-applicable'/空/其它 → null，绝不猜）。
export function parseNutriScore(grade: unknown): string | null {
  if (typeof grade !== 'string') return null
  const g = grade.trim().toLowerCase()
  return ['a', 'b', 'c', 'd', 'e'].includes(g) ? g : null
}

/// NOVA 加工组：只接受 1..4（OFF 可能返回数字或字符串）；其它/无数据 → null。
export function parseNovaGroup(g: unknown): number | null {
  const n = typeof g === 'number' ? g : (typeof g === 'string' ? Number(g.trim()) : NaN)
  return Number.isInteger(n) && n >= 1 && n <= 4 ? n : null
}

const NUTRIENT_KEYS = new Set(['fat', 'saturated-fat', 'sugars', 'salt'])
const NUTRIENT_LEVEL_VALUES = new Set(['low', 'moderate', 'high'])
/// 逐营养素含量档（OFF nutrient_levels）：{fat/saturated-fat/sugars/salt → low|moderate|high}。
/// 严格白名单——只收这 4 素 × 3 档，其它键/值（如 OFF 偶发的 energy、拼写变体、非字符串）一律丢弃；
/// 非对象/数组→空对象。存全档（low/moderate/high）由客户端决定播报口径（只警示 high）。
export function extractNutrientLevels(v: unknown): Record<string, string> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return {}
  const out: Record<string, string> = {}
  for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
    const key = k.trim().toLowerCase()
    if (!NUTRIENT_KEYS.has(key) || typeof val !== 'string') continue
    const level = val.trim().toLowerCase()
    if (NUTRIENT_LEVEL_VALUES.has(level)) out[key] = level
  }
  return out
}

/// 查询结果三态：found=命中；notFound=上游明确未收录/有记录但无名（可长缓存）；
/// failed=超时/网络/非200/解析异常（**瞬时故障，路由层不可长缓存**——否则一次抖动使该条码对全体 404 一天，
/// iOS 端用户随后自己起名后 name(for:) 本地命中永不再回源、过敏原标注永久缺失，见复审#5/#10）。
export type LookupOutcome =
  | { kind: 'found'; info: ProductInfo }
  | { kind: 'notFound' }
  | { kind: 'failed' }

/// 查一个条码，区分"真未收录(notFound)"与"瞬时故障(failed)"（用于差异化缓存；两者对客户端都表现为拿不到名字）。
export async function lookupProduct(barcode: string, fetchImpl: FetchLike, timeoutMs = 5000): Promise<LookupOutcome> {
  const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json?fields=product_name,brands,allergens_tags,traces_tags,nutriscore_grade,nova_group,labels_tags,quantity,nutrient_levels`
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetchImpl(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'BeeUrEi/1.0 (self-hosted assistive app for blind users)' },
    })
    if (!res.ok) return { kind: 'failed' } // 非 200：上游侧问题，视为瞬时故障不长缓存
    const data = (await res.json()) as Record<string, unknown> | null
    if (!data || data.status !== 1) return { kind: 'notFound' } // status 1=收录，0=明确未收录
    const name = composeProductName(data.product)
    if (!name) return { kind: 'notFound' } // 有记录但无可读名：等同未收录
    const p = data.product as Record<string, unknown> | undefined
    return { kind: 'found', info: {
      name,
      allergens: extractAllergens(p?.allergens_tags),
      traces: extractAllergens(p?.traces_tags), // traces_tags 与 allergens_tags 同格式，复用同一规范化提取
      nutriScore: parseNutriScore(p?.nutriscore_grade),
      novaGroup: parseNovaGroup(p?.nova_group),
      dietaryLabels: extractDietaryLabels(p?.labels_tags),
      quantity: parseQuantity(p?.quantity),
      nutrientLevels: extractNutrientLevels(p?.nutrient_levels),
    } }
  } catch {
    return { kind: 'failed' } // 超时/网络/解析异常：瞬时故障，不长缓存，绝不编造商品名
  } finally {
    clearTimeout(timer)
  }
}
