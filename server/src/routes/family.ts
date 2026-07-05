import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { type Store, type FamilyLink, isBlockedBetween, matchBannedTerm } from '../db/store'
import { requireAuth } from '../auth/rbac'
import { requireFeature } from '../auth/featureGate'
import { type PushSender, NoopPushSender } from '../push/apns'
import { pushLang, pushStrings } from '../push/pushStrings'
import { notifyUser } from '../notifications/notify'

const addLinkSchema = z.object({
  username: z.string().min(3).max(32).optional(),
  userId: z.string().min(1).max(64).optional(), // 通话中加好友只有对方 userId
  relation: z.string().min(1).max(32).optional(),
  isEmergency: z.boolean().optional(),
  phone: z.string().max(32).optional(),
}).refine((d) => d.username || d.userId, { message: 'username_or_userId_required' })

export function registerFamilyRoutes(app: FastifyInstance, store: Store, push: PushSender = new NoopPushSender(),
                                     isOnline: (userId: string) => boolean = () => false): void {
  // 发起加亲友/协助者请求（**双向**：盲人或协助者/亲友任一方都可发起，由另一方确认才建立关系）。
  // owner 恒为视障侧（保证匹配/紧急用 linksByOwner(blind) 成立）；requestedBy 记录发起方。
  // 限流：好友请求会向目标发推送。200 条上限只约束**并发** link 数，挡不住"发满→删除→再发"的循环刷推送
  // （审查 #7 已点名"群发好友请求推送骚扰"为威胁，但绝对上限不限速率）。补每分钟上限，掐断高频刷推送环路。
  // 与 groups/media/reports 等"建记录+外发"端点同口径。20/min 远高于正常用户加联系人频率（测试单例最多 4）。
  app.post('/api/family/links', { preHandler: [requireAuth(), requireFeature(store, 'familyLinks')],
                                  config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (req, reply) => {
    const parsed = addLinkSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    // relation 是对方在"待确认请求"列表与好友请求推送里能看到的用户文本——须过内容审核（与昵称/消息/群名同口径）。
    // 否则可经好友请求的 relation 字段向**陌生人**发违禁内容，绕过"需先建立关系"的消息过滤。正常端为预设称谓，此处防改造客户端。
    if (parsed.data.relation && matchBannedTerm(store.getAppConfig(), parsed.data.relation)) return reply.code(403).send({ error: 'content_blocked' })
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
    // 上面的 existing(=linksByOwner(target)) 只约束"被绑定的视障侧"。当发起方是非盲（member 侧，
    // ownerId=target≠meId）时它约束不到发起方自身——单个非盲账号可向无数不同目标发 pending 请求：
    // 既无界增长 link 记录，又把好友请求推送群发骚扰（每目标各推一条）。补发起方自身上限（与 owner 同口径）。
    if (ownerId !== meId && store.linksByMember(meId).length >= 200) return reply.code(422).send({ error: 'too_many_links' })

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
    // 通知"被请求方"(target)有新的好友请求待确认——走 notifyUser（持久收件箱 + 尽力推送），与
    // friend_accepted 对称：否则 web-only 亲友（无 APNs token）收到请求时零通知，只能靠翻"待确认"
    // 页才发现（见 e70c968 friend_accepted 持久化同因）。文案按收件人语言。
    const rlang = pushLang(target.language)
    notifyUser(store, push, target.id, 'friend_request',
               pushStrings.friendRequestTitle(rlang),
               pushStrings.friendRequestBody(me.displayName, link.relation, rlang), { linkId: link.id })
    return reply.code(201).send({ link: viewLink(store, link, meId) })
  })

  // 确认请求：只有"被请求方"（不是发起者）可接受。接受后才参与匹配/呼叫/紧急。
  app.post('/api/family/links/:id/accept', { preHandler: [requireAuth(), requireFeature(store, 'familyLinks')] }, async (req, reply) => {
    const meId = req.user!.sub
    const id = (req.params as { id: string }).id
    const link = store.findLink(id)
    if (!link) return reply.code(404).send({ error: 'not_found' })
    const isParty = link.ownerId === meId || link.memberId === meId
    // 旧数据无 requestedBy：兜底回原逻辑（member 接受）。
    const canAccept = isParty && (link.requestedBy ? link.requestedBy !== meId : link.memberId === meId)
    if (!canAccept) return reply.code(404).send({ error: 'not_found' })
    // 幂等：已是 accepted 则直接返回，不重复建链、更不重复给发起者发"已接受"通知（web 接受按钮无节流，
    // 双击/网络重试会重复调用；旧数据无 status 默认 accepted，视同已接受）。仅 pending 才真正接受。
    if ((link.status ?? 'accepted') === 'accepted') return reply.code(200).send({ ok: true })
    // 与 addLink 同口径：拉黑关系下不得接受（请求可能在拉黑前发出）——否则会在黑名单双方间建出
    // 一条"已接受却处处被拉黑拦截"的死链（出现在联系人列表却无法互动）。解除拉黑后请求仍在，可再接受。
    if (isBlockedBetween(store, meId, counterpartId(link, meId))) return reply.code(403).send({ error: 'blocked' })
    store.createLink({ ...link, status: 'accepted' })
    // 告知发起者"对方已接受"：走 notifyUser（持久通知 + 尽力推送），而非纯推送——
    // 否则对无 push token 的 web 端发起者完全无感（接受后好友只是静悄悄出现在列表里），
    // 与紧急告警同类的"web-only 漏收"缺口。requestedBy 为发起者 id。
    const requester = link.requestedBy ? store.findById(link.requestedBy) : undefined
    const me = store.findById(meId)
    if (requester && me) {
      const lang = pushLang(requester.language)
      notifyUser(store, push, requester.id, 'friend_accepted',
                 pushStrings.friendAcceptedTitle(lang), pushStrings.friendAcceptedBody(me.displayName, lang))
    }
    return { ok: true }
  })

  // 切换某联系人是否为**紧急联系人**（isEmergency）。此前只能在建链时设、之后无法改——
  // 而紧急告警优先级/升级重呼/医疗信息可见都依赖它，用户必须能事后调整谁是自己的紧急联系人。
  // 授权：仅链的 **owner**（= 设置"谁是我的紧急联系人"的一方，与建链时 owner 设 isEmergency 同口径）可改。
  app.post('/api/family/links/:id/emergency', { preHandler: requireAuth() }, async (req, reply) => {
    const parsed = z.object({ isEmergency: z.boolean() }).safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    const meId = req.user!.sub
    const link = store.findLink((req.params as { id: string }).id)
    if (!link) return reply.code(404).send({ error: 'not_found' })
    if (link.ownerId !== meId) return reply.code(403).send({ error: 'not_owner' }) // 仅 owner 可指定其紧急联系人
    store.createLink({ ...link, isEmergency: parsed.data.isEmergency }) // 读-合并-写（INSERT OR REPLACE，同 accept 改 status）
    // 被设为紧急联系人须知情（会收到该用户的 SOS/摔倒/未报到告警）：仅在 false→true 真正"新设"时通知对方一次，
    // 取消/重复设 true 不扰。与 friend_request/accepted 同口径（关系状态变更通知当事方）；notifyUser 双通道+勿扰兜底。
    if (parsed.data.isEmergency && link.isEmergency !== true) {
      const contactId = counterpartId(link, meId) // owner 之外的一方=被设者
      const owner = store.findById(meId)
      const contact = store.findById(contactId)
      if (owner && contact) {
        const l = pushLang(contact.language)
        notifyUser(store, push, contactId, 'emergency_contact_set',
                   pushStrings.emergencyContactSetTitle(l), pushStrings.emergencyContactSetBody(owner.displayName, l),
                   { linkId: link.id })
      }
    }
    return { link: viewLink(store, { ...link, isEmergency: parsed.data.isEmergency }, meId, isOnline) }
  })

  // 我的关系列表（我作为 owner 或 member 任一方都列出；展示"对方"）。
  app.get('/api/family/links', { preHandler: requireAuth() }, async (req) => {
    const meId = req.user!.sub
    const mine = [...store.linksByOwner(meId), ...store.linksByMember(meId)]
    return { links: mine.map((l) => viewLink(store, l, meId, isOnline)) }
  })

  // 待我确认的请求（对方发起、我还没接受；双向通用）。
  app.get('/api/family/incoming', { preHandler: requireAuth() }, async (req) => {
    const meId = req.user!.sub
    const pending = [...store.linksByOwner(meId), ...store.linksByMember(meId)].filter(
      (l) => (l.status ?? 'accepted') === 'pending' && (l.requestedBy ? l.requestedBy !== meId : l.memberId === meId)
        && !isBlockedBetween(store, meId, counterpartId(l, meId)), // 不展示来自/涉及拉黑对象的请求（解除拉黑后自然重现）
    )
    return { links: pending.map((l) => incomingView(store, l, meId)) }
  })

  // 删除一条关系/撤销请求/拒绝：任一方本人均可。
  app.delete('/api/family/links/:id', { preHandler: requireAuth() }, async (req, reply) => {
    const meId = req.user!.sub
    const id = (req.params as { id: string }).id
    const link = store.findLink(id)
    if (!link) return reply.code(204).send() // 幂等删除：已不存在即视为成功（双击/重试第二次不再报错，同录制删除口径）
    if (link.ownerId !== meId && link.memberId !== meId) return reply.code(404).send({ error: 'not_found' }) // 存在但非本人的关系：不可删
    store.deleteLink(id)
    return reply.code(204).send()
  })
}

/// 对方 id（相对查看者）。
function counterpartId(link: FamilyLink, meId: string): string {
  return link.ownerId === meId ? link.memberId : link.ownerId
}

/// 关系视图（memberId/memberName 表示"对方"，沿用 iOS FamilyLinkInfo 字段名）。
function viewLink(store: Store, link: FamilyLink, meId: string, isOnline: (userId: string) => boolean = () => false) {
  const otherId = counterpartId(link, meId)
  const other = store.findById(otherId)
  const accepted = (link.status ?? 'accepted') === 'accepted'
  return {
    id: link.id,
    memberId: otherId,
    memberName: other?.displayName ?? '未知',
    memberAvatar: other?.avatar ?? null,
    relation: link.relation,
    isEmergency: link.isEmergency,
    amOwner: link.ownerId === meId, // 我是否为该链 owner（= 能否指定其为我的紧急联系人）
    phone: link.phone,
    status: link.status ?? 'accepted',
    outgoing: (link.status ?? 'accepted') === 'pending' && link.requestedBy === meId, // 我发起、待对方确认
    online: accepted && isOnline(otherId), // 对方此刻在线/待命（仅已建立关系才算——pending 未确认不显示状态）
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
