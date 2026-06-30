import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { type Store, type ChatMessage, isBlockedBetween, publicUser, matchBannedTerm, areLinked } from '../db/store'
import { totalUnreadFor } from '../db/unread'
import { requireAuth } from '../auth/rbac'
import { requireFeature } from '../auth/featureGate'
import { NoopPushSender, type PushSender } from '../push/apns'
import { pushLang, pushStrings, type PushLang } from '../push/pushStrings'
import { removeMediaFile } from '../media/storage'

const sendSchema = z.object({
  toId: z.string().min(1).optional(),    // 单聊收件人（与 groupId 二选一）
  groupId: z.string().min(1).optional(), // 群消息所属群（与 toId 二选一）
  kind: z.enum(['text', 'audio', 'image', 'video', 'location']).default('text'),
  // text：正文 ≤4000 字；audio/image：data URL（base64）≤ 550KB；video：mediaId（先 POST /api/media 上传）；
  // location：JSON {lat,lng,name?}。
  text: z.string().min(1).max(550_000),
})

const audioPrefix = /^data:audio\/(m4a|mp4|aac|x-m4a);base64,/
const imagePrefix = /^data:image\/(png|jpeg|jpg|webp);base64,/
// 位置载荷：合法经纬度 + 可选地址（≤200 字）。客户端编码进 text 字段。
const locationSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  name: z.string().max(200).optional(),
})
function isValidLocation(text: string): boolean {
  try { return locationSchema.safeParse(JSON.parse(text)).success } catch { return false }
}
/// 取位置载荷里的用户可见地址名（用于内容审核——否则违禁词塞进位置名可绕过文本过滤）。
function locationName(text: string): string {
  try { return locationSchema.parse(JSON.parse(text)).name ?? '' } catch { return '' }
}

/// 聊天（参照 WhatsApp/iMessage 核心集：文本 + 语音条 + 图片 + 视频 + 已读回执 + 未读数 + 推送）。
/// 单聊互发资格 = 双方存在 **accepted** 绑定且无任一方向拉黑；群消息资格 = 群成员。
export function registerMessageRoutes(app: FastifyInstance, store: Store,
                                      pushSender: PushSender = new NoopPushSender()): void {

  /// 推送预览文案（语音/图片/视频/位置用占位，文本截 80 字）。
  function previewOf(kind: ChatMessage['kind'], text: string, l: PushLang): string {
    if (kind === 'audio') return l === 'en' ? '[Voice message]' : '[语音消息]'
    if (kind === 'image') return l === 'en' ? '[Photo]' : '[图片]'
    if (kind === 'video') return l === 'en' ? '[Video]' : '[视频]'
    if (kind === 'location') return l === 'en' ? '[Location]' : '[位置]'
    // iOS 默认把位置发成 kind=text + 内嵌 Apple 地图链接：推送预览也显示 [位置]，
    // 否则盲人收到的推送是一串原始 maps URL（与 iOS/web 列表预览保持一致）。
    if (text.includes('https://maps.apple.com/?ll=')) return l === 'en' ? '[Location]' : '[位置]'
    return text.slice(0, 80)
  }

  // 发送消息（单聊传 toId，群聊传 groupId）。
  app.post('/api/messages', { preHandler: [requireAuth(), requireFeature(store, 'messaging')],
                              config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
    const parsed = sendSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    const me = req.user!.sub
    const { toId, groupId, kind, text } = parsed.data
    if ((toId ? 1 : 0) + (groupId ? 1 : 0) !== 1) return reply.code(400).send({ error: 'invalid_input' }) // 恰好一个目标
    if (kind === 'text' && text.length > 4000) return reply.code(400).send({ error: 'message_too_long' })
    // 内容过滤（主动审核）：text 类消息命中违禁词则拒收（默认空词表=不生效）。
    if (kind === 'text' && matchBannedTerm(store.getAppConfig(), text)) return reply.code(403).send({ error: 'content_blocked' })
    if (kind === 'audio' && !audioPrefix.test(text)) return reply.code(400).send({ error: 'invalid_audio' })
    if (kind === 'image' && !imagePrefix.test(text)) return reply.code(400).send({ error: 'invalid_image' })
    if (kind === 'location' && !isValidLocation(text)) return reply.code(400).send({ error: 'invalid_location' })
    // 位置名是用户文本，同样过审违禁词（否则把违禁内容塞进地址名即可绕过 text 过滤）。
    if (kind === 'location' && matchBannedTerm(store.getAppConfig(), locationName(text))) return reply.code(403).send({ error: 'content_blocked' })
    if (kind === 'video') {
      // text = mediaId：必须是发送者本人刚上传的视频文件。
      const media = store.findMedia(text)
      if (!media || media.ownerId !== me || !media.mime.startsWith('video/')) {
        return reply.code(400).send({ error: 'invalid_video' })
      }
    }

    const sender = store.findById(me)

    if (groupId) {
      const group = store.findGroup(groupId)
      if (!group) return reply.code(404).send({ error: 'not_found' })
      if (!group.memberIds.includes(me)) return reply.code(403).send({ error: 'not_member' })

      const msg: ChatMessage = { id: randomUUID(), fromId: me, toId: '', groupId, kind, text, createdAt: Date.now() }
      store.createMessage(msg)
      store.setGroupRead(groupId, me, msg.createdAt) // 自己发的群消息对自己即读

      // 推送给群里其他成员（尽力而为）：**并行扇出 + 不阻塞发送回执**。
      // 此前是串行 await——50 人群发一条消息要等 49 次 APNs 往返才返回 201，发送方明显卡顿。
      // 推送本就是尽力而为，故 fire-and-forget：立即 201，推送在后台并行投递、各自吞错。
      if (sender) {
        for (const memberId of group.memberIds) {
          if (memberId === me) continue
          const member = store.findById(memberId)
          if (!member?.apnsToken) continue
          const l = pushLang(member.language)
          void pushSender.sendAlert(member.apnsToken,
            pushStrings.groupMessageTitle(sender.displayName, group.name, l),
            pushStrings.newMessageBody(previewOf(kind, text, l), l),
            { type: 'chat_message', groupId }, `group:${groupId}`, // 按群分组折叠通知
            totalUnreadFor(store, memberId).total) // 图标角标=该成员未读总数（含本条）
            .catch(() => { /* 单个成员推送失败不影响其他成员与发送回执 */ })
        }
      }
      return reply.code(201).send({ message: msg })
    }

    // 单聊
    if (toId === me) return reply.code(400).send({ error: 'invalid_input' })
    if (!store.findById(toId!)) return reply.code(404).send({ error: 'not_found' })
    if (!areLinked(store, me, toId!)) return reply.code(403).send({ error: 'not_linked' })       // 仅绑定好友可互发
    if (isBlockedBetween(store, me, toId!)) return reply.code(403).send({ error: 'blocked' })

    const msg: ChatMessage = { id: randomUUID(), fromId: me, toId: toId!, kind, text, createdAt: Date.now() }
    store.createMessage(msg)

    // 提醒推送（尽力而为，不阻塞发送回执）。
    const recipient = store.findById(toId!)
    if (recipient?.apnsToken && sender) {
      const l = pushLang(recipient.language)
      void pushSender.sendAlert(recipient.apnsToken,
        pushStrings.newMessageTitle(sender.displayName, l),
        pushStrings.newMessageBody(previewOf(kind, text, l), l),
        { type: 'chat_message', fromId: me }, `dm:${me}`, // 按发送者分组折叠通知
        totalUnreadFor(store, toId!).total) // 图标角标=收件人未读总数（含本条）
        .catch(() => { /* 推送失败不影响消息已存库与发送回执 */ })
    }
    return reply.code(201).send({ message: msg })
  })

  // 消息列表（时间正序；before 向前翻页）：?with=单聊对端 或 ?group=群 id。
  app.get('/api/messages', { preHandler: requireAuth() }, async (req, reply) => {
    const q = req.query as { with?: string; group?: string; before?: string; beforeId?: string; limit?: string }
    const me = req.user!.sub
    const limit = Math.min(Math.max(Number(q.limit) || 50, 1), 200)
    const before = q.before ? Number(q.before) : undefined
    const beforeId = q.beforeId || undefined // 与 before 组成复合游标，翻页边界遇同毫秒消息不漏
    if (q.group) {
      const group = store.findGroup(q.group)
      if (!group) return reply.code(404).send({ error: 'not_found' })
      if (!group.memberIds.includes(me)) return reply.code(403).send({ error: 'not_member' })
      return { messages: store.groupMessages(q.group, limit, before, beforeId) }
    }
    const peer = q.with
    if (!peer) return reply.code(400).send({ error: 'invalid_input' })
    if (!areLinked(store, me, peer)) return reply.code(403).send({ error: 'not_linked' })
    return { messages: store.messagesBetween(me, peer, limit, before, beforeId) }
  })

  // 会话内搜索文本消息：?q=关键词 + (?with=对端 或 ?group=群 id)。时间倒序，最多 50 条。
  // 鉴权同消息列表（单聊须 accepted 绑定、群须成员），不泄漏无权会话的内容。
  app.get('/api/messages/search', { preHandler: requireAuth() }, async (req, reply) => {
    const q = req.query as { q?: string; with?: string; group?: string; limit?: string }
    const me = req.user!.sub
    const query = (q.q ?? '').trim()
    if (query === '') return { messages: [] } // 空查询不报错，返回空，便于前端边输边查
    const limit = Math.min(Math.max(Number(q.limit) || 50, 1), 100)
    if (q.group) {
      const group = store.findGroup(q.group)
      if (!group) return reply.code(404).send({ error: 'not_found' })
      if (!group.memberIds.includes(me)) return reply.code(403).send({ error: 'not_member' })
      return { messages: store.searchGroupMessages(q.group, query, limit) }
    }
    const peer = q.with
    if (!peer) return reply.code(400).send({ error: 'invalid_input' })
    if (!areLinked(store, me, peer)) return reply.code(403).send({ error: 'not_linked' })
    return { messages: store.searchDirectMessages(me, peer, query, limit) }
  })

  // 撤回自己发出的消息（WhatsApp 式：双方都看到"已撤回"占位）。限发出后 2 分钟内。
  // 视频消息撤回同时删除服务器上的媒体文件。
  app.post('/api/messages/:id/recall', { preHandler: [requireAuth(), requireFeature(store, 'messaging')] }, async (req, reply) => {
    const id = (req.params as { id: string }).id
    const msg = store.findMessage(id)
    if (!msg) return reply.code(404).send({ error: 'not_found' })
    if (msg.fromId !== req.user!.sub) return reply.code(403).send({ error: 'not_yours' })
    if (Date.now() - msg.createdAt > 2 * 60_000) return reply.code(400).send({ error: 'recall_window_passed' })
    if (msg.kind === 'video' && msg.text !== '') {
      store.deleteMedia(msg.text)
      removeMediaFile(msg.text)
    }
    const updated = store.updateMessage(id, { kind: 'recalled', text: '', reaction: undefined })
    return { message: updated }
  })

  // 表情回应（WhatsApp 式：单 emoji，最新覆盖；空字符串取消）。单聊双方或群成员可操作。
  app.post('/api/messages/:id/reaction', { preHandler: [requireAuth(), requireFeature(store, 'messaging')] }, async (req, reply) => {
    const parsed = z.object({ emoji: z.string().max(16) }).safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    const id = (req.params as { id: string }).id
    const msg = store.findMessage(id)
    if (!msg) return reply.code(404).send({ error: 'not_found' })
    const me = req.user!.sub
    if (msg.groupId) {
      const group = store.findGroup(msg.groupId)
      if (!group?.memberIds.includes(me)) return reply.code(403).send({ error: 'not_participant' })
    } else if (msg.fromId !== me && msg.toId !== me) {
      return reply.code(403).send({ error: 'not_participant' })
    }
    if (msg.kind === 'recalled') return reply.code(400).send({ error: 'message_recalled' })
    const emoji = parsed.data.emoji.trim()
    const updated = store.updateMessage(id, { reaction: emoji.length === 0 ? undefined : emoji })
    return { message: updated }
  })

  // 标记已读：单聊传 fromId（已读回执），群聊传 groupId（按人记"读到的时间戳"）。
  app.post('/api/messages/read', { preHandler: requireAuth() }, async (req, reply) => {
    const parsed = z.object({ fromId: z.string().min(1).optional(), groupId: z.string().min(1).optional() })
      .safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    const me = req.user!.sub
    if (parsed.data.groupId) {
      const group = store.findGroup(parsed.data.groupId)
      if (!group) return reply.code(404).send({ error: 'not_found' })
      if (!group.memberIds.includes(me)) return reply.code(403).send({ error: 'not_member' })
      store.setGroupRead(group.id, me, Date.now())
      return { ok: true }
    }
    if (!parsed.data.fromId) return reply.code(400).send({ error: 'invalid_input' })
    const n = store.markMessagesRead(me, parsed.data.fromId, Date.now())
    return { ok: true, read: n }
  })

  // 会话列表：每个对端最后一条 + 未读数 + 对端公开资料（仅单聊；群会话见 GET /api/groups）。
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

  /// 未读汇总（单聊 + 群聊 + 铃铛通知）：供网页标签标题/导航徽标一次性轻量拉取，
  /// 免得为算总数去拉完整会话/群列表。群未读口径与 GET /api/groups 一致。
  app.get('/api/unread', { preHandler: requireAuth() }, async (req) => {
    return totalUnreadFor(store, req.user!.sub)
  })
}
