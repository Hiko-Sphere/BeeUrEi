import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { type Store } from '../db/store'
import { requireAuth } from '../auth/rbac'

// VoIP token 必须是十六进制（PushKit token = 32 字节 = 64 hex）。严格限制字符集，
// 防止用户可控值带非法字符注入 APNs 的 :path（/3/device/<token>），见复审 #8。
const tokenSchema = z.object({ voipToken: z.string().regex(/^[0-9a-fA-F]{64,200}$/) })

/// PushKit VoIP token 注册（A1 后台来电）。客户端拿到 token 后上报，发呼叫时据此推送。
export function registerPushRoutes(app: FastifyInstance, store: Store): void {
  app.post('/api/push/register', { preHandler: requireAuth() }, async (req, reply) => {
    const parsed = tokenSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    store.updateUser(req.user!.sub, { voipToken: parsed.data.voipToken })
    return { ok: true }
  })

  // 注销（退出登录/关闭来电时调用，停止后续推送到该设备）。
  app.delete('/api/push/register', { preHandler: requireAuth() }, async (req) => {
    store.updateUser(req.user!.sub, { voipToken: undefined })
    return { ok: true }
  })
}
