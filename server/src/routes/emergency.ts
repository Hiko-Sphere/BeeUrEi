import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { type Store } from '../db/store'
import { requireAuth } from '../auth/rbac'
import { planEmergencyRoute } from '../emergency/routing'
import { NoopPushSender, type PushSender } from '../push/apns'
import { pushLang, pushStrings } from '../push/pushStrings'

const alertSchema = z.object({
  kind: z.enum(['fall', 'crash', 'manual']), // manual=用户手动 SOS（未实名门禁屏等处的紧急按钮）

  lat: z.number().min(-90).max(90).optional(),
  lon: z.number().min(-180).max(180).optional(),
})

export function registerEmergencyRoutes(app: FastifyInstance, store: Store,
                                        pushSender: PushSender = new NoopPushSender()): void {
  // 发起紧急呼叫：返回按优先级排好的呼叫目标列表（真正接通由 WebRTC 信令负责）。
  app.post('/api/emergency/trigger', { preHandler: requireAuth() }, async (req) => {
    const owner = req.user!
    // 仅 accepted 的绑定可作为紧急联系人（pending 未经对方同意，不参与紧急路由，见审查 #6）。
    const links = store.linksByOwner(owner.sub).filter((l) => (l.status ?? 'accepted') === 'accepted')
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

  // 摔倒/车祸自动警报：检测端确认（倒计时无人取消）后调用——给所有 accepted 绑定的亲友/协助者
  // 发提醒推送（按收件人语言选文案，带可选坐标）。pending 绑定不通知（未经对方同意，同审查 #6 原则）。
  app.post('/api/emergency/alert', { preHandler: requireAuth(),
                                     config: { rateLimit: { max: 6, timeWindow: '1 minute' } } }, async (req, reply) => {
    const parsed = alertSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    const me = store.findById(req.user!.sub)
    if (!me) return reply.code(404).send({ error: 'not_found' })

    const links = store.linksByOwner(me.id).filter((l) => (l.status ?? 'accepted') === 'accepted')
    // 安全攸关：所有亲友必须**并行**收到告警，且任一推送失败绝不能中断其余推送或 500 整个请求。
    // 此前串行 await——第一个亲友的 APNs 抛错会让后面所有亲友收不到摔倒告警。
    const recipients = links
      .map((link) => store.findById(link.memberId))
      .filter((m): m is NonNullable<typeof m> => !!m?.apnsToken)
    const extraBase: Record<string, string> = { type: 'emergency_alert', kind: parsed.data.kind, fromId: me.id }
    if (parsed.data.lat != null && parsed.data.lon != null) {
      extraBase.lat = String(parsed.data.lat)
      extraBase.lon = String(parsed.data.lon)
    }
    await Promise.allSettled(recipients.map((member) => {
      const l = pushLang(member.language)
      return pushSender.sendAlert(member.apnsToken!,
        pushStrings.emergencyAlertTitle(me.displayName, l),
        pushStrings.emergencyAlertBody(parsed.data.kind, parsed.data.lat != null, l),
        extraBase)
    }))
    return { ok: true, notified: recipients.length, contacts: links.length }
  })
}
