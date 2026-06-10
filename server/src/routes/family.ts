import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { type Store, type FamilyLink, isBlockedBetween } from '../db/store'
import { requireAuth } from '../auth/rbac'
import { type PushSender, NoopPushSender } from '../push/apns'
import { pushLang, pushStrings } from '../push/pushStrings'

const addLinkSchema = z.object({
  username: z.string().min(3).max(32).optional(),
  userId: z.string().min(1).max(64).optional(), // 通话中加好友只有对方 userId
  relation: z.string().min(1).max(32).optional(),
  isEmergency: z.boolean().optional(),
  phone: z.string().max(32).optional(),
}).refine((d) => d.username || d.userId, { message: 'username_or_userId_required' })

export function registerFamilyRoutes(app: FastifyInstance, store: Store, push: PushSender = new NoopPushSender()): void {
  // 发起加亲友/协助者请求（**双向**：盲人或协助者/亲友任一方都可发起，由另一方确认才建立关系）。
  // owner 恒为视障侧（保证匹配/紧急用 linksByOwner(blind) 成立）；requestedBy 记录发起方。
  app.post('/api/family/links', { preHandler: requireAuth() }, async (req, reply) => {
    const parsed = addLinkSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    const meId = req.user!.sub
    const me = store.findById(meId)
    const target = parsed.data.userId ? store.findById(parsed.data.userId) : store.findByUsername(parsed.data.username!.trim())
    if (!me || !target) return reply.code(404).send({ error: 'member_not_found' })
    if (target.id === meId) return reply.code(400).send({ error: 'cannot_link_self' })
    if (isBlockedBetween(store, meId, target.id)) return reply.code(403).send({ error: 'blocked' })

    const iAmBlind = me.role === 'blind'
    const ownerId = iAmBlind ? meId : target.id   // 视障侧恒为 owner
    const memberId = iAmBlind ? target.id : meId

    // 去重 + 上限（按 owner 维度，防重复绑定/无界增长，见审查 #7）。
    const existing = store.linksByOwner(ownerId)
    if (existing.some((l) => l.memberId === memberId)) return reply.code(409).send({ error: 'already_linked' })
    if (existing.length >= 200) return reply.code(422).send({ error: 'too_many_links' })

    const link: FamilyLink = {
      id: randomUUID(),
      ownerId,
      memberId,
      relation: parsed.data.relation ?? '亲友',
      isEmergency: parsed.data.isEmergency ?? false,
      phone: parsed.data.phone,
      createdAt: Date.now(),
      status: 'pending', // 仅 accepted 参与匹配/呼叫/紧急（见审查 #6）
      requestedBy: meId,
    }
    store.createLink(link)
    // 软件外通知：提醒"被请求方"(target)有新的好友请求待确认。fire-and-forget。文案按收件人语言。
    if (target.apnsToken) {
      const lang = pushLang(target.language)
      void push.sendAlert(target.apnsToken, pushStrings.friendRequestTitle(lang),
                          pushStrings.friendRequestBody(me.displayName, link.relation, lang), { kind: 'friend_request' })
        .catch((e) => console.warn('[push] friend_request alert failed:', (e as Error).message))
    }
    return reply.code(201).send({ link: viewLink(store, link, meId) })
  })

  // 确认请求：只有"被请求方"（不是发起者）可接受。接受后才参与匹配/呼叫/紧急。
  app.post('/api/family/links/:id/accept', { preHandler: requireAuth() }, async (req, reply) => {
    const meId = req.user!.sub
    const id = (req.params as { id: string }).id
    const link = store.findLink(id)
    if (!link) return reply.code(404).send({ error: 'not_found' })
    const isParty = link.ownerId === meId || link.memberId === meId
    // 旧数据无 requestedBy：兜底回原逻辑（member 接受）。
    const canAccept = isParty && (link.requestedBy ? link.requestedBy !== meId : link.memberId === meId)
    if (!canAccept) return reply.code(404).send({ error: 'not_found' })
    store.createLink({ ...link, status: 'accepted' })
    // 软件外通知：告诉"发起者"对方已接受。fire-and-forget。
    const requester = link.requestedBy ? store.findById(link.requestedBy) : undefined
    const me = store.findById(meId)
    if (requester?.apnsToken && me) {
      const lang = pushLang(requester.language)
      void push.sendAlert(requester.apnsToken, pushStrings.friendAcceptedTitle(lang),
                          pushStrings.friendAcceptedBody(me.displayName, lang), { kind: 'friend_accepted' })
        .catch((e) => console.warn('[push] friend_accepted alert failed:', (e as Error).message))
    }
    return { ok: true }
  })

  // 我的关系列表（我作为 owner 或 member 任一方都列出；展示"对方"）。
  app.get('/api/family/links', { preHandler: requireAuth() }, async (req) => {
    const meId = req.user!.sub
    const mine = [...store.linksByOwner(meId), ...store.linksByMember(meId)]
    return { links: mine.map((l) => viewLink(store, l, meId)) }
  })

  // 待我确认的请求（对方发起、我还没接受；双向通用）。
  app.get('/api/family/incoming', { preHandler: requireAuth() }, async (req) => {
    const meId = req.user!.sub
    const pending = [...store.linksByOwner(meId), ...store.linksByMember(meId)].filter(
      (l) => (l.status ?? 'accepted') === 'pending' && (l.requestedBy ? l.requestedBy !== meId : l.memberId === meId),
    )
    return { links: pending.map((l) => incomingView(store, l, meId)) }
  })

  // 删除一条关系/撤销请求/拒绝：任一方本人均可。
  app.delete('/api/family/links/:id', { preHandler: requireAuth() }, async (req, reply) => {
    const meId = req.user!.sub
    const id = (req.params as { id: string }).id
    const link = store.findLink(id)
    if (!link || (link.ownerId !== meId && link.memberId !== meId)) return reply.code(404).send({ error: 'not_found' })
    store.deleteLink(id)
    return reply.code(204).send()
  })
}

/// 对方 id（相对查看者）。
function counterpartId(link: FamilyLink, meId: string): string {
  return link.ownerId === meId ? link.memberId : link.ownerId
}

/// 关系视图（memberId/memberName 表示"对方"，沿用 iOS FamilyLinkInfo 字段名）。
function viewLink(store: Store, link: FamilyLink, meId: string) {
  const otherId = counterpartId(link, meId)
  const other = store.findById(otherId)
  return {
    id: link.id,
    memberId: otherId,
    memberName: other?.displayName ?? '未知',
    memberAvatar: other?.avatar ?? null,
    relation: link.relation,
    isEmergency: link.isEmergency,
    phone: link.phone,
    status: link.status ?? 'accepted',
    outgoing: (link.status ?? 'accepted') === 'pending' && link.requestedBy === meId, // 我发起、待对方确认
  }
}

/// 待确认请求视图（ownerId/ownerName 表示"对方/发起者"，沿用 iOS IncomingLinkInfo 字段名）。
function incomingView(store: Store, link: FamilyLink, meId: string) {
  const otherId = counterpartId(link, meId)
  const other = store.findById(otherId)
  return {
    id: link.id,
    ownerId: otherId,
    ownerName: other?.displayName ?? '未知',
    ownerAvatar: other?.avatar ?? null,
    relation: link.relation,
    isEmergency: link.isEmergency,
    status: link.status ?? 'accepted',
  }
}
