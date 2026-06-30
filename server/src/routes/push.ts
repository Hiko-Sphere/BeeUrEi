import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { type Store } from '../db/store'
import { requireAuth } from '../auth/rbac'

// VoIP token 必须是十六进制（PushKit token = 32 字节 = 64 hex）。严格限制字符集，
// 防止用户可控值带非法字符注入 APNs 的 :path（/3/device/<token>），见复审 #8。
const tokenSchema = z.object({ voipToken: z.string().regex(/^[0-9a-fA-F]{64,200}$/) })
// 普通 APNs token 同为十六进制（注入防护同 VoIP，见复审 #8）。
const apnsTokenSchema = z.object({ token: z.string().regex(/^[0-9a-fA-F]{64,200}$/) })

/// PushKit VoIP token 注册（A1 后台来电）。客户端拿到 token 后上报，发呼叫时据此推送。
export function registerPushRoutes(app: FastifyInstance, store: Store): void {
  app.post('/api/push/register', { preHandler: requireAuth() }, async (req, reply) => {
    const parsed = tokenSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    store.clearVoipTokenFromOthers(parsed.data.voipToken, req.user!.sub) // 设备换账号：从旧账号收回此 token，防跨账号来电推送
    store.updateUser(req.user!.sub, { voipToken: parsed.data.voipToken })
    return { ok: true }
  })

  // 注销（退出登录/关闭来电时调用，停止后续推送到该设备）。
  app.delete('/api/push/register', { preHandler: requireAuth() }, async (req) => {
    store.updateUser(req.user!.sub, { voipToken: undefined })
    return { ok: true }
  })

  // 普通 APNs token 注册（软件外提醒推送：好友请求/被接受等）。
  app.post('/api/push/apns-register', { preHandler: requireAuth() }, async (req, reply) => {
    const parsed = apnsTokenSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    store.clearApnsTokenFromOthers(parsed.data.token, req.user!.sub) // 设备换账号：从旧账号收回此 token，防跨账号提醒推送泄漏
    store.updateUser(req.user!.sub, { apnsToken: parsed.data.token })
    return { ok: true }
  })
  app.delete('/api/push/apns-register', { preHandler: requireAuth() }, async (req) => {
    store.updateUser(req.user!.sub, { apnsToken: undefined })
    return { ok: true }
  })
}
