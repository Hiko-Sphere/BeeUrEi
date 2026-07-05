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
  const full = brand && name
    ? (name.includes(brand) ? name : `${brand} ${name}`) // 名字已含品牌不重复
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

/// 查询结果三态：found=命中；notFound=上游明确未收录/有记录但无名（可长缓存）；
/// failed=超时/网络/非200/解析异常（**瞬时故障，路由层不可长缓存**——否则一次抖动使该条码对全体 404 一天，
/// iOS 端用户随后自己起名后 name(for:) 本地命中永不再回源、过敏原标注永久缺失，见复审#5/#10）。
export type LookupOutcome =
  | { kind: 'found'; info: ProductInfo }
  | { kind: 'notFound' }
  | { kind: 'failed' }

/// 查一个条码，区分"真未收录(notFound)"与"瞬时故障(failed)"（用于差异化缓存；两者对客户端都表现为拿不到名字）。
export async function lookupProduct(barcode: string, fetchImpl: FetchLike, timeoutMs = 5000): Promise<LookupOutcome> {
  const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json?fields=product_name,brands,allergens_tags,traces_tags,nutriscore_grade,nova_group`
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
    } }
  } catch {
    return { kind: 'failed' } // 超时/网络/解析异常：瞬时故障，不长缓存，绝不编造商品名
  } finally {
    clearTimeout(timer)
  }
}
