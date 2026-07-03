import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { type Store, publicUser, matchBannedTerm, areLinked } from '../db/store'
import { dissolveGroup } from '../db/cascade'
import { requireAuth } from '../auth/rbac'
import { requireFeature } from '../auth/featureGate'
import { type PushSender, NoopPushSender } from '../push/apns'
import { pushLang, pushStrings } from '../push/pushStrings'
import { notifyUser } from '../notifications/notify'

const createSchema = z.object({
  name: z.string().trim().min(1).max(50),
  memberIds: z.array(z.string().min(1)).min(1).max(49), // 除群主外 1~49 人（群上限 50）
})

const MAX_MEMBERS = 50

/// 群聊（WhatsApp 式）：群主建群/加人/踢人/解散；成员可退群。
/// 建群与加人都要求新成员是**群主**的 accepted 绑定好友——沿用"只有互相确认过的人才能进入对话"的原则。
export function registerGroupRoutes(app: FastifyInstance, store: Store, push: PushSender = new NoopPushSender()): void {
  // 建群：发起人为群主，初始成员必须都是群主的好友。
  app.post('/api/groups', { preHandler: [requireAuth(), requireFeature(store, 'groups')],
                            config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const parsed = createSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    if (matchBannedTerm(store.getAppConfig(), parsed.data.name)) return reply.code(403).send({ error: 'content_blocked' })
    const me = req.user!.sub
    const memberIds = [...new Set(parsed.data.memberIds)].filter((id) => id !== me)
    if (memberIds.length === 0) return reply.code(400).send({ error: 'invalid_input' })
    for (const id of memberIds) {
      if (!store.findById(id)) return reply.code(404).send({ error: 'not_found' })
      if (!areLinked(store, me, id)) return reply.code(403).send({ error: 'not_linked' })
    }
    const group = { id: randomUUID(), name: parsed.data.name, ownerId: me,
                    memberIds: [me, ...memberIds], createdAt: Date.now() }
    store.createGroup(group)
    store.setGroupRead(group.id, me, Date.now()) // 群主建群即视为已读
    // 通知初始成员被加入群聊——否则盲人只能靠群列表突然多出一个群才发现（收件箱 + 推送）。
    notifyGroupAdded(store, push, memberIds, me, group.name, group.id)
    return reply.code(201).send({ group })
  })

  // 我的群列表：群信息 + 成员公开资料 + 最后一条消息 + 未读数（晚于我的已读时间且非我发的）。
  app.get('/api/groups', { preHandler: requireAuth() }, async (req) => {
    const me = req.user!.sub
    const groups = store.groupsFor(me).map((g) => {
      const recent = store.groupMessages(g.id, 200)
      const readAt = store.groupReadAt(g.id, me)
      return {
        group: g,
        members: g.memberIds.map((id) => {
          const u = store.findById(id)
          return u ? publicUser(u) : { id, username: '', displayName: '已注销用户', role: '', status: '', avatar: null }
        }),
        last: recent.length > 0 ? recent[recent.length - 1] : null,
        unread: recent.filter((m) => m.createdAt > readAt && m.fromId !== me && m.kind !== 'recalled').length,
      }
    })
    // 最近活跃的群在前（无消息按建群时间）。
    groups.sort((a, b) => (b.last?.createdAt ?? b.group.createdAt) - (a.last?.createdAt ?? a.group.createdAt))
    return { groups }
  })

  // 加人（群主）：新成员须是群主好友。
  app.post('/api/groups/:id/members', { preHandler: [requireAuth(), requireFeature(store, 'groups')] }, async (req, reply) => {
    const parsed = z.object({ userId: z.string().min(1) }).safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    const group = store.findGroup((req.params as { id: string }).id)
    if (!group) return reply.code(404).send({ error: 'not_found' })
    const me = req.user!.sub
    if (group.ownerId !== me) return reply.code(403).send({ error: 'not_owner' })
    const userId = parsed.data.userId
    if (group.memberIds.includes(userId)) return reply.code(400).send({ error: 'already_member' })
    if (group.memberIds.length >= MAX_MEMBERS) return reply.code(400).send({ error: 'group_full' })
    if (!store.findById(userId)) return reply.code(404).send({ error: 'not_found' })
    if (!areLinked(store, me, userId)) return reply.code(403).send({ error: 'not_linked' })
    const updated = store.updateGroup(group.id, { memberIds: [...group.memberIds, userId] })
    // 新成员的"已读时刻"置为入群此刻——否则其未读数会把**入群前**的全部历史消息(至多 200 上限)都算上，
    // 刚进群就顶着一个巨大的未读角标（历史仍可上翻查看，只是不计未读）。与建群时群主 setGroupRead 同口径。
    store.setGroupRead(group.id, userId, Date.now())
    notifyGroupAdded(store, push, [userId], me, group.name, group.id) // 通知被加入者
    return { group: updated }
  })

  // 移出成员：群主可踢任何非群主成员；普通成员只能移出自己（退群）。群主退群=解散。
  app.delete('/api/groups/:id/members/:userId', { preHandler: requireAuth() }, async (req, reply) => {
    const { id, userId } = req.params as { id: string; userId: string }
    const group = store.findGroup(id)
    if (!group) return reply.code(404).send({ error: 'not_found' })
    const me = req.user!.sub
    if (!group.memberIds.includes(userId)) return reply.code(404).send({ error: 'not_member' })
    if (userId === group.ownerId) return reply.code(400).send({ error: 'owner_must_dissolve' })
    if (me !== group.ownerId && me !== userId) return reply.code(403).send({ error: 'forbidden' })
    const updated = store.updateGroup(group.id, { memberIds: group.memberIds.filter((m) => m !== userId) })
    // 群主踢人才通知被踢者（自愿退群不通知自己）——否则被移出的盲人只见群悄然消失、不知缘由。
    if (me === group.ownerId && userId !== me) {
      const l = pushLang(store.findById(userId)?.language)
      notifyUser(store, push, userId, 'group_removed',
                 pushStrings.groupRemovedTitle(l), pushStrings.groupRemovedBody(group.name, l), { groupId: group.id })
    }
    return { group: updated }
  })

  // 解散（群主）：级联删除群消息与已读标记；视频消息的媒体文件一并清理。
  app.delete('/api/groups/:id', { preHandler: requireAuth() }, async (req, reply) => {
    const group = store.findGroup((req.params as { id: string }).id)
    if (!group) return reply.code(404).send({ error: 'not_found' })
    if (group.ownerId !== req.user!.sub) return reply.code(403).send({ error: 'not_owner' })
    // 通知须在 dissolveGroup（删群）**之前**捕获成员——删后 group 已不存在。群主自己不通知。
    const others = group.memberIds.filter((m) => m !== group.ownerId)
    dissolveGroup(store, group.id) // 清群内视频媒体 + 删群；与删号级联共用同一实现
    for (const uid of others) {
      const l = pushLang(store.findById(uid)?.language)
      notifyUser(store, push, uid, 'group_dissolved',
                 pushStrings.groupDissolvedTitle(l), pushStrings.groupDissolvedBody(group.name, l))
    }
    return { ok: true }
  })
}

/// 通知一批用户被加入群聊（建群/加人共用）。按各自语言本地化；notifyUser 内部 best-effort 隔离。
function notifyGroupAdded(store: Store, push: PushSender, userIds: string[], actorId: string, groupName: string, groupId: string): void {
  const actorName = store.findById(actorId)?.displayName ?? ''
  for (const uid of userIds) {
    const l = pushLang(store.findById(uid)?.language)
    notifyUser(store, push, uid, 'group_added',
               pushStrings.groupAddedTitle(l), pushStrings.groupAddedBody(actorName, groupName, l), { groupId })
  }
}
