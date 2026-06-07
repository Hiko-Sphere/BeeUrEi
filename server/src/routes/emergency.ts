import type { FastifyInstance } from 'fastify'
import { type Store } from '../db/store'
import { requireAuth } from '../auth/rbac'
import { planEmergencyRoute } from '../emergency/routing'

export function registerEmergencyRoutes(app: FastifyInstance, store: Store): void {
  // 发起紧急呼叫：返回按优先级排好的呼叫目标列表（真正接通由 WebRTC 信令负责）。
  app.post('/api/emergency/trigger', { preHandler: requireAuth() }, async (req) => {
    const owner = req.user!
    const links = store.linksByOwner(owner.sub)
    const ordered = planEmergencyRoute(links)
    const targets = ordered.map((l) => {
      const member = store.findById(l.memberId)
      return {
        memberId: l.memberId,
        memberName: member?.displayName ?? '未知',
        relation: l.relation,
        isEmergency: l.isEmergency,
      }
    })
    return { targets, count: targets.length }
  })
}
