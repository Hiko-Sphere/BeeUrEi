import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { requireAuth } from '../auth/rbac'
import { type Store, type SavedPlace, matchBannedTerm } from '../db/store'
import { amapGeocode } from '../nav/amapClient'
import { gcj02ToWgs84 } from '../nav/chinaCoord'

/// 保存时一次性地理编码出 WGS-84 坐标缓存（供"到家了"围栏判定，不改导航路径）。best-effort：
/// 未配 amap / 境外地址 / 查不到 / 出错 → 返回 undefined，地点照存、只是无围栏。amapGeocode 返回 GCJ-02，转回 WGS-84。
async function geocodeToWgs(address: string): Promise<{ lat: number; lng: number } | undefined> {
  try {
    const g = await amapGeocode(address) // GCJ-02 坐标 + 规范化全称（此处只需坐标供围栏，名字不用）
    if (!g) return undefined
    const [lonS, latS] = g.location.split(',')
    const lon = Number(lonS), lat = Number(latS)
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180) return undefined
    const w = gcj02ToWgs84(lat, lon)
    return { lat: w.lat, lng: w.lon }
  } catch { return undefined } // 地理编码失败绝不阻断保存
}

/// 保存的地点（"家"/"公司"/自定义如"医院"）：盲人日常"带我回家/去公司"免每次报地址。
/// 只存**本人**地点、**只存地址字符串**（导航时由 walking/transit 端点实时 geocode，不存坐标、免坐标系纠缠）。
/// 按 (ownerId,label) upsert：家/公司各唯一，改地址即覆盖。
const MAX_PLACES_PER_USER = 30
const labelSchema = z.string().trim().min(1).max(32)
const upsertSchema = z.object({ address: z.string().trim().min(1).max(200) })

export function registerSavedPlaceRoutes(app: FastifyInstance, store: Store): void {
  // 列出我保存的地点（updatedAt 倒序）。
  app.get('/api/places', { preHandler: requireAuth() }, async (req) => {
    return { places: store.savedPlacesForUser(req.user!.sub) }
  })

  // 新增/更新一个地点（按 label 覆盖）。20/min 限流（写端点每次全量写盘，防 churn）。
  app.put('/api/places/:label', { preHandler: requireAuth(), config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
    const labelParsed = labelSchema.safeParse((req.params as { label: string }).label)
    const bodyParsed = upsertSchema.safeParse(req.body)
    if (!labelParsed.success || !bodyParsed.success) return reply.code(400).send({ error: 'invalid_input' })
    const label = labelParsed.data
    const address = bodyParsed.data.address
    // label 与 address 都会被 TTS 念给盲人（"已把家设为 XX 路"），与消息同口径过违禁词。
    const cfg = store.getAppConfig()
    if (matchBannedTerm(cfg, label) || matchBannedTerm(cfg, address)) return reply.code(403).send({ error: 'content_blocked' })
    const me = req.user!.sub
    const existing = store.savedPlacesForUser(me)
    // 仅"新 label 且已达上限"才拒（更新已有 label 不占新名额）。
    if (!existing.some((p) => p.label === label) && existing.length >= MAX_PLACES_PER_USER) {
      return reply.code(429).send({ error: 'place_limit' })
    }
    const coord = await geocodeToWgs(address) // 缓存坐标供到达围栏；失败则无坐标、地点照存
    const place: SavedPlace = { ownerId: me, label, address, lat: coord?.lat, lng: coord?.lng, updatedAt: Date.now() }
    store.upsertSavedPlace(place)
    return { place }
  })

  // 删除一个地点（幂等：不存在也照常返回）。
  app.delete('/api/places/:label', { preHandler: requireAuth(), config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req) => {
    store.deleteSavedPlace(req.user!.sub, (req.params as { label: string }).label)
    return { ok: true }
  })
}
