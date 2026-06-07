import type { FastifyInstance } from 'fastify'
import { type Store } from '../db/store'
import { requireAuth } from '../auth/rbac'

/// 开发者测试端点（仅 developer 角色）。App 端的开发者模式是手动开启的本地叠层，
/// 与此处的后端测试端点相互独立。
export function registerDevRoutes(app: FastifyInstance, store: Store): void {
  const devOnly = { preHandler: requireAuth(['developer']) }

  app.get('/api/dev/ping', devOnly, async () => ({ ok: true }))

  app.get('/api/dev/stats', devOnly, async () => {
    const users = store.allUsers()
    return {
      users: users.length,
      byRole: users.reduce<Record<string, number>>((acc, u) => {
        acc[u.role] = (acc[u.role] ?? 0) + 1
        return acc
      }, {}),
      reports: store.allReports().length,
      recordings: store.allRecordings().length,
    }
  })
}
