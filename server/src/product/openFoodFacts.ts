/// Open Food Facts 商品条码查询（免密钥、公开数据库）：EAN/UPC → 商品名。盲人在店里扫到没起过名的商品时，
/// 先在线查一次直接报出品牌+名字（对标 Seeing AI「产品」频道），查不到再回退让用户自己起名——绝不编造。
/// 解析/组名是纯逻辑（可单测）；网络由注入的 fetchImpl 提供（生产用全局 fetch，测试传桩）。

export interface ProductInfo { name: string }

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

/// 查一个条码；找到且有名 → ProductInfo，否则 null（未收录/字段空/非 200/超时/网络异常一律 null，不猜）。
export async function lookupProduct(barcode: string, fetchImpl: FetchLike, timeoutMs = 5000): Promise<ProductInfo | null> {
  const url = `https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(barcode)}.json?fields=product_name,brands`
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetchImpl(url, {
      signal: ctrl.signal,
      headers: { 'User-Agent': 'BeeUrEi/1.0 (self-hosted assistive app for blind users)' },
    })
    if (!res.ok) return null
    const data = (await res.json()) as Record<string, unknown> | null
    if (!data || data.status !== 1) return null // status 1=收录，0=未收录
    const name = composeProductName(data.product)
    return name ? { name } : null
  } catch {
    return null // 超时/网络/解析异常：回退用户起名，绝不编造商品名
  } finally {
    clearTimeout(timer)
  }
}
