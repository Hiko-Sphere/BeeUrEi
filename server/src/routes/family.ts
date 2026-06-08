import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { type Store, type FamilyLink } from '../db/store'
import { requireAuth } from '../auth/rbac'

const addLinkSchema = z.object({
  username: z.string().min(3).max(32),
  relation: z.string().min(1).max(32).optional(),
  isEmergency: z.boolean().optional(),
})

export function registerFamilyRoutes(app: FastifyInstance, store: Store): void {
  // 添加一位亲友/协助者（按对方用户名绑定）。
  app.post('/api/family/links', { preHandler: requireAuth() }, async (req, reply) => {
    const parsed = addLinkSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })

    const owner = req.user!
    const member = store.findByUsername(parsed.data.username)
    if (!member) return reply.code(404).send({ error: 'member_not_found' })
    if (member.id === owner.sub) return reply.code(400).send({ error: 'cannot_link_self' })

    const link: FamilyLink = {
      id: randomUUID(),
      ownerId: owner.sub,
      memberId: member.id,
      relation: parsed.data.relation ?? '亲友',
      isEmergency: parsed.data.isEmergency ?? false,
      createdAt: Date.now(),
    }
    store.createLink(link)
    return reply.code(201).send({ link: viewLink(store, link) })
  })

  // 列出我的亲友。
  app.get('/api/family/links', { preHandler: requireAuth() }, async (req) => {
    const owner = req.user!
    return { links: store.linksByOwner(owner.sub).map((l) => viewLink(store, l)) }
  })

  // 成员侧：列出"谁把我加为亲友/协助者"（供亲友/协助者角色查看）。
  app.get('/api/family/incoming', { preHandler: requireAuth() }, async (req) => {
    const me = req.user!
    return {
      links: store.linksByMember(me.sub).map((l) => {
        const owner = store.findById(l.ownerId)
        return {
          id: l.id,
          ownerId: l.ownerId,
          ownerName: owner?.displayName ?? '未知',
          relation: l.relation,
          isEmergency: l.isEmergency,
        }
      }),
    }
  })

  // 删除一条绑定（仅本人）。
  app.delete('/api/family/links/:id', { preHandler: requireAuth() }, async (req, reply) => {
    const owner = req.user!
    const id = (req.params as { id: string }).id
    const link = store.findLink(id)
    if (!link || link.ownerId !== owner.sub) return reply.code(404).send({ error: 'not_found' })
    store.deleteLink(id)
    return reply.code(204).send()
  })
}

function viewLink(store: Store, link: FamilyLink) {
  const member = store.findById(link.memberId)
  return {
    id: link.id,
    memberId: link.memberId,
    memberName: member?.displayName ?? '未知',
    relation: link.relation,
    isEmergency: link.isEmergency,
  }
}
