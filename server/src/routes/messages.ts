import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { type Store, type ChatMessage, isBlockedBetween, publicUser } from '../db/store'
import { requireAuth } from '../auth/rbac'
import { NoopPushSender, type PushSender } from '../push/apns'
import { pushLang, pushStrings } from '../push/pushStrings'

const sendSchema = z.object({
  toId: z.string().min(1),
  kind: z.enum(['text', 'audio']).default('text'),
  // text：正文 ≤4000 字；audio：data URL（m4a/aac base64）≤ 400KB（约 20 秒语音条）。
  text: z.string().min(1).max(550_000),
})

const audioPrefix = /^data:audio\/(m4a|mp4|aac|x-m4a);base64,/

/// 聊天（参照 WhatsApp/iMessage 核心集：文本 + 语音条 + 已读回执 + 未读数 + 推送）。
/// 互发资格 = 双方存在 **accepted** 绑定（好友体系复用既有"双向同意绑定"），且无任一方向拉黑。
export function registerMessageRoutes(app: FastifyInstance, store: Store,
                                      pushSender: PushSender = new NoopPushSender()): void {
  /// 双方是否互为 accepted 绑定（任一方向 owner/member 均可）。
  function linked(a: string, b: string): boolean {
    const ok = (l: { status?: string }) => (l.status ?? 'accepted') === 'accepted'
    return store.linksByOwner(a).some((l) => l.memberId === b && ok(l))
      || store.linksByMember(a).some((l) => l.ownerId === b && ok(l))
  }

  // 发送消息。
  app.post('/api/messages', { preHandler: requireAuth(),
                              config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
    const parsed = sendSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    const me = req.user!.sub
    const { toId, kind, text } = parsed.data
    if (toId === me) return reply.code(400).send({ error: 'invalid_input' })
    if (kind === 'text' && text.length > 4000) return reply.code(400).send({ error: 'message_too_long' })
    if (kind === 'audio' && !audioPrefix.test(text)) return reply.code(400).send({ error: 'invalid_audio' })
    if (!store.findById(toId)) return reply.code(404).send({ error: 'not_found' })
    if (!linked(me, toId)) return reply.code(403).send({ error: 'not_linked' })       // 仅绑定好友可互发
    if (isBlockedBetween(store, me, toId)) return reply.code(403).send({ error: 'blocked' })

    const msg: ChatMessage = { id: randomUUID(), fromId: me, toId, kind, text, createdAt: Date.now() }
    store.createMessage(msg)

    // 提醒推送（尽力而为；语音条预览用"[语音]"）。
    const recipient = store.findById(toId)
    const sender = store.findById(me)
    if (recipient?.apnsToken && sender) {
      const l = pushLang(recipient.language)
      const preview = kind === 'audio' ? (l === 'en' ? '[Voice message]' : '[语音消息]')
                                       : text.slice(0, 80)
      await pushSender.sendAlert(recipient.apnsToken,
        pushStrings.newMessageTitle(sender.displayName, l),
        pushStrings.newMessageBody(preview, l),
        { type: 'chat_message', fromId: me })
    }
    return reply.code(201).send({ message: msg })
  })

  // 与某人的消息列表（时间正序；before 向前翻页）。
  app.get('/api/messages', { preHandler: requireAuth() }, async (req, reply) => {
    const q = req.query as { with?: string; before?: string; limit?: string }
    const peer = q.with
    if (!peer) return reply.code(400).send({ error: 'invalid_input' })
    const me = req.user!.sub
    if (!linked(me, peer)) return reply.code(403).send({ error: 'not_linked' })
    const limit = Math.min(Math.max(Number(q.limit) || 50, 1), 200)
    const before = q.before ? Number(q.before) : undefined
    return { messages: store.messagesBetween(me, peer, limit, before) }
  })

  // 标记某人发来的消息已读（已读回执）。
  app.post('/api/messages/read', { preHandler: requireAuth() }, async (req, reply) => {
    const parsed = z.object({ fromId: z.string().min(1) }).safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    const n = store.markMessagesRead(req.user!.sub, parsed.data.fromId, Date.now())
    return { ok: true, read: n }
  })

  // 会话列表：每个对端最后一条 + 未读数 + 对端公开资料。
  app.get('/api/conversations', { preHandler: requireAuth() }, async (req) => {
    const me = req.user!.sub
    const conversations = store.latestMessagesPerPeer(me).map((m) => {
      const peerId = m.fromId === me ? m.toId : m.fromId
      const peer = store.findById(peerId)
      return {
        peer: peer ? publicUser(peer) : { id: peerId, username: '', displayName: '已注销用户', role: '', status: '', avatar: null },
        last: m,
        unread: store.unreadCount(me, peerId),
      }
    })
    return { conversations }
  })
}
