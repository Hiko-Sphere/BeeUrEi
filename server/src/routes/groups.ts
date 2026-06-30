import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { type Store, publicUser, matchBannedTerm } from '../db/store'
import { dissolveGroup } from '../db/cascade'
import { requireAuth } from '../auth/rbac'
import { requireFeature } from '../auth/featureGate'

const createSchema = z.object({
  name: z.string().trim().min(1).max(50),
  memberIds: z.array(z.string().min(1)).min(1).max(49), // 除群主外 1~49 人（群上限 50）
})

const MAX_MEMBERS = 50

/// 群聊（WhatsApp 式）：群主建群/加人/踢人/解散；成员可退群。
/// 建群与加人都要求新成员是**群主**的 accepted 绑定好友——沿用"只有互相确认过的人才能进入对话"的原则。
export function registerGroupRoutes(app: FastifyInstance, store: Store): void {
  /// a、b 是否互为 accepted 绑定（任一方向）。
  function linked(a: string, b: string): boolean {
    const ok = (l: { status?: string }) => (l.status ?? 'accepted') === 'accepted'
    return store.linksByOwner(a).some((l) => l.memberId === b && ok(l))
      || store.linksByMember(a).some((l) => l.ownerId === b && ok(l))
  }

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
      if (!linked(me, id)) return reply.code(403).send({ error: 'not_linked' })
    }
    const group = { id: randomUUID(), name: parsed.data.name, ownerId: me,
                    memberIds: [me, ...memberIds], createdAt: Date.now() }
    store.createGroup(group)
    store.setGroupRead(group.id, me, Date.now()) // 群主建群即视为已读
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
    if (!linked(me, userId)) return reply.code(403).send({ error: 'not_linked' })
    const updated = store.updateGroup(group.id, { memberIds: [...group.memberIds, userId] })
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
    return { group: updated }
  })

  // 解散（群主）：级联删除群消息与已读标记；视频消息的媒体文件一并清理。
  app.delete('/api/groups/:id', { preHandler: requireAuth() }, async (req, reply) => {
    const group = store.findGroup((req.params as { id: string }).id)
    if (!group) return reply.code(404).send({ error: 'not_found' })
    if (group.ownerId !== req.user!.sub) return reply.code(403).send({ error: 'not_owner' })
    dissolveGroup(store, group.id) // 清群内视频媒体 + 删群；与删号级联共用同一实现
    return { ok: true }
  })
}
