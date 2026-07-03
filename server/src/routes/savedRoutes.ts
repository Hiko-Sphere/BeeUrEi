import type { FastifyInstance } from 'fastify'
import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { requireAuth } from '../auth/rbac'
import { type Store, type SavedRoute, matchBannedTerm, areLinked, isBlockedBetween } from '../db/store'
import { type PushSender, NoopPushSender } from '../push/apns'
import { pushLang, pushStrings } from '../push/pushStrings'
import { notifyUser } from '../notifications/notify'

/// 路线库（亲友远程路线编排，Soundscape Guided Routes 式）：
/// 亲友在网页地图上替盲人踩好常走路线（家→菜场），盲人端沿信标一键执行；盲人也可自存路线。
/// 授权模型：路线归属 owner（执行的盲人）；替他人建路线须与其为 **accepted 互链且无拉黑**。
/// 坐标全程 WGS-84（全栈约定，见 SavedRoute 注释）——本层只校验数值有界，绝不做坐标系转换。
const MAX_ROUTES_PER_OWNER = 50   // 滥用上限：单归属者路线数（灌爆防护）
const MAX_WAYPOINTS = 200         // 单条路线航点上限（步行路线足够；防超大 payload）

const waypointSchema = z.object({
  lat: z.number().finite().min(-90).max(90),
  lng: z.number().finite().min(-180).max(180),
  note: z.string().trim().max(60).optional(), // 航点提示语（"过了报亭右转"），随信标播报
})
const createSchema = z.object({
  forUserId: z.string().max(64).optional(), // 缺省=给自己建
  name: z.string().trim().min(1).max(40),
  waypoints: z.array(waypointSchema).min(2).max(MAX_WAYPOINTS),
})
const updateSchema = z.object({
  name: z.string().trim().min(1).max(40).optional(),
  waypoints: z.array(waypointSchema).min(2).max(MAX_WAYPOINTS).optional(),
}).refine((v) => v.name !== undefined || v.waypoints !== undefined, { message: 'empty_patch' })

/// 视图：不多不少地回传客户端所需（含 viewer 相对角色，客户端据此分"我的路线/我替 TA 画的"）。
/// createdByName：创建者显示名——盲人执行路线时据此知道"这条是谁画的"（自己画的 / 女儿画的），
/// 是信任透明的关键（人工路线的可信度取决于是谁画的）。self 创建时为 null（客户端显示"自存"）。
/// 创建者必为 owner 的 accepted 互链联系人（建路线时已强制），故对 owner 披露其名无隐私问题。
function routeView(store: Store, r: SavedRoute, viewerId: string) {
  const createdByName = r.createdBy === r.ownerId ? null : (store.findById(r.createdBy)?.displayName ?? null)
  return {
    id: r.id, ownerId: r.ownerId, createdBy: r.createdBy, createdByName, name: r.name,
    waypoints: r.waypoints, createdAt: r.createdAt, updatedAt: r.updatedAt,
    role: r.ownerId === viewerId ? 'owner' : 'creator',
  }
}

/// 编辑/删除权限：归属者或绘制者（其余 404 不泄露存在性——与媒体/录制端点同口径）。
function canEdit(r: SavedRoute, userId: string): boolean {
  return r.ownerId === userId || r.createdBy === userId
}

/// 航点备注（note）会被 iOS 端作为逐航点指令用 TTS 念给盲人——是唯一直达盲人听觉的自由文本，
/// 必须与 name 同口径过违禁词过滤，否则拉黑关系/骚扰内容可绕过管控直接播报给视障用户。
function anyNoteBlocked(store: Store, waypoints: { note?: string }[] | undefined): boolean {
  if (!waypoints) return false
  const cfg = store.getAppConfig()
  return waypoints.some((w) => w.note != null && matchBannedTerm(cfg, w.note) != null)
}

export function registerSavedRouteRoutes(app: FastifyInstance, store: Store, push: PushSender = new NoopPushSender()): void {
  // 建路线：给自己，或给 accepted 互链且无拉黑的联系人（亲友替盲人画路线的主通道）。
  // 20/min 限流（与建链同档）：写端点每次全量写盘（JsonFileStore afterMutate），防 churn 型 I/O 放大与批量灌建。
  app.post('/api/routes', { preHandler: requireAuth(), config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const parsed = createSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    const me = req.user!.sub
    const ownerId = parsed.data.forUserId ?? me
    if (ownerId !== me) {
      const target = store.findById(ownerId)
      if (!target) return reply.code(404).send({ error: 'not_found' })
      if (isBlockedBetween(store, me, ownerId)) return reply.code(403).send({ error: 'blocked' })
      if (!areLinked(store, me, ownerId)) return reply.code(403).send({ error: 'not_linked' })
    }
    if (matchBannedTerm(store.getAppConfig(), parsed.data.name) || anyNoteBlocked(store, parsed.data.waypoints)) {
      return reply.code(403).send({ error: 'content_blocked' })
    }
    if (store.savedRoutesForUser(ownerId).length >= MAX_ROUTES_PER_OWNER) {
      return reply.code(429).send({ error: 'route_limit' })
    }
    const now = Date.now()
    const route: SavedRoute = {
      id: randomUUID(), ownerId, createdBy: me,
      name: parsed.data.name, waypoints: parsed.data.waypoints,
      createdAt: now, updatedAt: now,
    }
    store.createSavedRoute(route)
    // 亲友替盲人建路线：通知盲人"有人为你加了路线"，否则盲人得自己去导航页翻才知道（收件箱 + 推送）。
    // 仅当替他人建时通知（给自己建不通知自己）；notifyUser 内部 best-effort，失败不影响主操作。
    if (ownerId !== me) {
      const l = pushLang(store.findById(ownerId)?.language)
      notifyUser(store, push, ownerId, 'route_added',
                 pushStrings.routeAddedTitle(l), pushStrings.routeAddedBody(store.findById(me)?.displayName ?? '', route.name, l),
                 { routeId: route.id })
    }
    return { route: routeView(store, route, me) }
  })

  // 我的路线（owner 维度）+ 我替别人画的（creator 维度），去重合并、updatedAt 倒序。
  // 已拉黑的 owner：不再回传我替其画的路线（与其他交互面同口径，使用时刻复查拉黑，不只在建路线时）。
  app.get('/api/routes', { preHandler: requireAuth() }, async (req) => {
    const me = req.user!.sub
    const seen = new Set<string>()
    const merged = [...store.savedRoutesForUser(me), ...store.savedRoutesByCreator(me)]
      .filter((r) => (seen.has(r.id) ? false : (seen.add(r.id), true)))
      .filter((r) => r.ownerId === me || !isBlockedBetween(store, me, r.ownerId))
      .sort((a, b) => b.updatedAt - a.updatedAt)
    return { routes: merged.map((r) => routeView(store, r, me)) }
  })

  // 改路线（名称/航点）：归属者或绘制者。绘制者与归属者已解绑后仍可编辑其画的路线——
  // 但**已拉黑**则不可（拉黑=明确不信任，绝不能让其静默改写盲人实地执行的路线；使用时刻复查，与全站同口径）。
  app.put('/api/routes/:id', { preHandler: requireAuth(), config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const id = (req.params as { id: string }).id
    const parsed = updateSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    const route = store.findSavedRoute(id)
    if (!route || !canEdit(route, req.user!.sub)) return reply.code(404).send({ error: 'not_found' })
    if (req.user!.sub !== route.ownerId && isBlockedBetween(store, req.user!.sub, route.ownerId)) {
      return reply.code(403).send({ error: 'blocked' })
    }
    if ((parsed.data.name && matchBannedTerm(store.getAppConfig(), parsed.data.name)) || anyNoteBlocked(store, parsed.data.waypoints)) {
      return reply.code(403).send({ error: 'content_blocked' })
    }
    const updated = store.updateSavedRoute(id, {
      ...(parsed.data.name ? { name: parsed.data.name } : {}),
      ...(parsed.data.waypoints ? { waypoints: parsed.data.waypoints } : {}),
      updatedAt: Date.now(),
    })!
    return { route: routeView(store, updated, req.user!.sub) }
  })

  // 删路线：归属者或绘制者；幂等（gone→204）。无权（含已拉黑的绘制者）一律 204 no-op——
  // 既保幂等又不泄露存在性（204/404 分叉本会成为存在性 oracle，违背"404 不泄露"设计）。
  app.delete('/api/routes/:id', { preHandler: requireAuth(), config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const id = (req.params as { id: string }).id
    const route = store.findSavedRoute(id)
    const blockedCreator = route && req.user!.sub !== route.ownerId && isBlockedBetween(store, req.user!.sub, route.ownerId)
    if (!route || !canEdit(route, req.user!.sub) || blockedCreator) return reply.code(204).send()
    store.deleteSavedRoute(id)
    return reply.code(204).send()
  })
}
