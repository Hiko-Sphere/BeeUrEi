import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { type Store, type ChatMessage, isBlockedBetween, publicUser, matchBannedTerm, areLinked, aggregateReactions } from '../db/store'

/// 读回执隐私（WhatsApp 语义）：单聊两端任一方显式关闭读回执（readReceiptsEnabled === false）即抑制
/// "已读"暴露（互惠——关了的人也看不到别人的）。缺省(undefined)=开。同步 store 读兜底：查不到人按"开"处理。
export function receiptsOffBetween(store: Store, a: string, b: string): boolean {
  try {
    return store.findById(a)?.readReceiptsEnabled === false || store.findById(b)?.readReceiptsEnabled === false
  } catch { return false }
}

/// 读回执剥离（单点，覆盖**所有**把消息回给"发送方本人"的出口：消息列表/会话 last/搜索/recall·edit·reaction 回显）。
/// 只处理"viewer 发出的单聊消息"：群消息不用 readAt（匿名计数另路）；对端发来的消息其 readAt 是 viewer 自己的
/// 已读时刻（本人数据，非隐私暴露）。最终批次复审抓到：仅在消息列表剥离，搜索与写操作回显两条旁路仍原样返回
/// readAt，读回执开关可被发送方绕过——收拢为单一助手，杜绝再新增出口时漏。
export function stripReadAtForViewer(store: Store, viewerId: string, m: ChatMessage): ChatMessage {
  if (m.groupId || m.fromId !== viewerId || m.readAt == null) return m
  return receiptsOffBetween(store, viewerId, m.toId) ? { ...m, readAt: undefined } : m
}

/// 给一批消息附上**逐用户表情回应**的聚合视图（按 viewer 算 mine）。批量取（一次 messageReactionsFor，不逐条 N+1）。
/// 向后兼容：某消息尚无逐用户回应行但有旧的单字段 reaction（本次上线前的旧回应）→ 合成一条 count=1 的胶囊
/// （mine 未知置 false），使旧回应仍可见、不凭空消失。撤回消息不带回应（recall 时已清）。
export function withReactions(store: Store, viewerId: string, msgs: ChatMessage[]): ChatMessage[] {
  const byId = store.messageReactionsFor(msgs.map((m) => m.id))
  return msgs.map((m) => {
    if (m.kind === 'recalled') return m
    const rows = byId.get(m.id)
    if (rows && rows.length) return { ...m, reactions: aggregateReactions(rows, viewerId) }
    if (m.reaction) return { ...m, reactions: [{ emoji: m.reaction, count: 1, mine: false }] } // 旧单字段回应兜底显示
    return m
  })
}
import { totalUnreadFor } from '../db/unread'
import { requireAuth } from '../auth/rbac'
import { requireFeature } from '../auth/featureGate'
import { NoopPushSender, type PushSender } from '../push/apns'
import { NoopWebPushSender, type WebPushSender } from '../push/webPush'
import { pushLang, pushStrings, type PushLang } from '../push/pushStrings'
import { shouldSuppressPush } from '../notifications/quietHours'
import { removeMediaFile } from '../media/storage'

const sendSchema = z.object({
  toId: z.string().min(1).optional(),    // 单聊收件人（与 groupId 二选一）
  groupId: z.string().min(1).optional(), // 群消息所属群（与 toId 二选一）
  kind: z.enum(['text', 'audio', 'image', 'video', 'location']).default('text'),
  // text：正文 ≤4000 字；audio/image：data URL（base64）≤ 550KB；video：mediaId（先 POST /api/media 上传）；
  // location：JSON {lat,lng,name?}。
  text: z.string().min(1).max(550_000),
  replyTo: z.string().min(1).max(64).optional(), // 引用回复的消息 id（须为同一会话内的消息，否则丢弃）
  forwarded: z.boolean().optional(), // 转发标记：客户端把某条消息转发到别处时置 true，收端标「已转发」
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
                                      pushSender: PushSender = new NoopPushSender(),
                                      webPush: WebPushSender = new NoopWebPushSender(),
                                      isOnline: (userId: string) => boolean = () => false): void {

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
    const { toId, groupId, kind, text, replyTo, forwarded } = parsed.data
    if ((toId ? 1 : 0) + (groupId ? 1 : 0) !== 1) return reply.code(400).send({ error: 'invalid_input' }) // 恰好一个目标
    // 引用回复：被引消息须**存在且属同一会话**（群内引群消息 / 单聊引同一对端往来），否则丢弃（不因陈旧引用拒发）。
    const validReplyTo = ((): string | undefined => {
      if (!replyTo) return undefined
      const r = store.findMessage(replyTo)
      if (!r) return undefined
      if (groupId) return r.groupId === groupId ? replyTo : undefined
      const pair = (r.fromId === me && r.toId === toId) || (r.fromId === toId && r.toId === me)
      return !r.groupId && pair ? replyTo : undefined
    })()
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
      // 且该媒体不得已被**录制实体**或**另一条视频消息**引用（与 recordings.ts 建录制守卫对称，见 iter55）。
      // 否则录制主可把自己那份录制的 mediaId 挂成一条临时视频消息、再在 2 分钟撤回窗内 recall→deleteMedia+
      // removeMediaFile，**销毁受法务保留/举报证据保护的录制源文件**（撤回删的名义是"消息媒体"，却连带毁了
      // 录制指向的同一物理文件）。也防两条消息共用一份媒体致撤回其一删掉另一条的媒体。录制媒体本有独立下载
      // 通道（/api/recordings），本就不该被当作聊天视频重复挂载。
      if (store.recordingByMediaId(text) || store.findVideoMessageByMediaId(text)) {
        return reply.code(409).send({ error: 'media_already_referenced' })
      }
    }

    const sender = store.findById(me)

    if (groupId) {
      const group = store.findGroup(groupId)
      if (!group) return reply.code(404).send({ error: 'not_found' })
      if (!group.memberIds.includes(me)) return reply.code(403).send({ error: 'not_member' })

      const msg: ChatMessage = { id: randomUUID(), fromId: me, toId: '', groupId, kind, text, createdAt: Date.now(), replyTo: validReplyTo, forwarded: forwarded || undefined }
      store.createMessage(msg)
      store.setGroupRead(groupId, me, msg.createdAt) // 自己发的群消息对自己即读

      // 推送给群里其他成员（尽力而为）：**并行扇出 + 不阻塞发送回执**。
      // 此前是串行 await——50 人群发一条消息要等 49 次 APNs 往返才返回 201，发送方明显卡顿。
      // 推送本就是尽力而为，故 fire-and-forget：立即 201，推送在后台并行投递、各自吞错。
      if (sender) {
        for (const memberId of group.memberIds) {
          if (memberId === me) continue
          // 单个成员的**同步** store 读（findById/未读角标/web 订阅）抛错（SQLITE_BUSY/IOERR）绝不能掐断对其余
          // 成员的推送——更不能在消息已存库(createMessage)后 500，让发送方重试→重复群发（见 SOS 扇出复审同类）。
          try {
            const member = store.findById(memberId)
            if (!member) continue
            // 群免打扰：该成员把此群静音 → 压推送横幅（消息已存库、未读照增，其打开即见）。比勿扰更细：只静此群。
            if (store.isGroupMuted(groupId, memberId)) continue
            // 勿扰时段：群消息推送横幅在成员本地勿扰时段内抑制（消息已存库，其打开即见、未读数照增）。
            if (shouldSuppressPush(member.quietHours, 'chat_message', Date.now())) continue
            const l = pushLang(member.language)
            const title = pushStrings.groupMessageTitle(sender.displayName, group.name, l)
            const body = pushStrings.newMessageBody(previewOf(kind, text, l), l)
            const badge = totalUnreadFor(store, memberId).total // 图标角标=该成员未读总数（含本条）；APNs+Web Push 同带
            if (member.apnsToken) {
              void pushSender.sendAlert(member.apnsToken, title, body,
                { type: 'chat_message', groupId }, `group:${groupId}`, // 按群分组折叠通知
                badge)
                .catch(() => { /* 单个成员推送失败不影响其他成员与发送回执 */ })
            }
            // Web Push 对齐 APNs：web-only 成员关掉标签页也能收到群消息（SW 按 groupId tag 折叠）。badge 顶层供 SW 置 PWA 图标角标。
            if (webPush.configured) {
              const payload = JSON.stringify({ title, body, badge, data: { kind: 'chat_message', groupId } })
              for (const sub of store.webPushSubscriptionsForUser(memberId)) void webPush.send(sub, payload).catch(() => {})
            }
          } catch { /* 单成员推送准备失败不阻断其余成员与 201 发送回执 */ }
        }
      }
      return reply.code(201).send({ message: msg })
    }

    // 单聊
    if (toId === me) return reply.code(400).send({ error: 'invalid_input' })
    if (!store.findById(toId!)) return reply.code(404).send({ error: 'not_found' })
    if (!areLinked(store, me, toId!)) return reply.code(403).send({ error: 'not_linked' })       // 仅绑定好友可互发
    if (isBlockedBetween(store, me, toId!)) return reply.code(403).send({ error: 'blocked' })

    const msg: ChatMessage = { id: randomUUID(), fromId: me, toId: toId!, kind, text, createdAt: Date.now(), replyTo: validReplyTo, forwarded: forwarded || undefined }
    store.createMessage(msg)

    // 提醒推送（尽力而为，不阻塞发送回执）。
    const recipient = store.findById(toId!)
    // 单聊免打扰 + 勿扰时段：收件人把与发送者的会话静音、或处于本地勿扰时段 → 压推送横幅（消息已存库、未读照增）。
    if (recipient && sender && !store.isDmMuted(toId!, me) && !shouldSuppressPush(recipient.quietHours, 'chat_message', Date.now())) {
      // 同步 store 读（未读角标/web 订阅）抛错（SQLITE_BUSY 等）绝不能在消息已存库后 500，让发送方重试→重复单聊。
      try {
        const l = pushLang(recipient.language)
        const title = pushStrings.newMessageTitle(sender.displayName, l)
        const body = pushStrings.newMessageBody(previewOf(kind, text, l), l)
        const badge = totalUnreadFor(store, toId!).total // 图标角标=收件人未读总数（含本条）；APNs+Web Push 同带
        if (recipient.apnsToken) {
          void pushSender.sendAlert(recipient.apnsToken, title, body,
            { type: 'chat_message', fromId: me }, `dm:${me}`, // 按发送者分组折叠通知
            badge)
            .catch(() => { /* 推送失败不影响消息已存库与发送回执 */ })
        }
        // Web Push 对齐 APNs：点开直达该对话（SW 据 fromId 路由）；按发送者 tag 折叠。badge 顶层供 SW 置 PWA 图标角标。
        if (webPush.configured) {
          const payload = JSON.stringify({ title, body, badge, data: { kind: 'chat_message', fromId: me } })
          for (const sub of store.webPushSubscriptionsForUser(toId!)) void webPush.send(sub, payload).catch(() => {})
        }
      } catch { /* 推送准备失败不影响消息已存库与 201 发送回执 */ }
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
      const msgs = store.groupMessages(q.group, limit, before, beforeId)
      // 群已读回执（对齐 WhatsApp「已读 N」）：仅对**我自己发的**非撤回消息，附「几位其他成员已读到该条」。
      // 已读判定＝该成员的 groupReadAt ≥ 该条 createdAt（读到时 setGroupRead=Date.now() ≥ 更早消息）。
      // 其他成员的 readAt 一次性取好（O(成员数)），再逐条比较；隐私上只暴露计数不暴露具体是谁读了。
      const others = group.memberIds.filter((id) => id !== me)
      const readTotal = others.length
      const otherReadAt = others.map((id) => store.groupReadAt(group.id, id))
      const withReceipts = msgs.map((m) => (m.fromId === me && m.kind !== 'recalled')
        ? { ...m, readBy: otherReadAt.filter((t) => t >= m.createdAt).length, readTotal }
        : m)
      // 群消息同样附逐用户表情回应——群正是"各回应各显、不互相顶掉"最需要的场景（单聊分支在下方已带，这里补齐姊妹分支）。
      return { messages: withReactions(store, me, withReceipts) }
    }
    const peer = q.with
    if (!peer) return reply.code(400).send({ error: 'invalid_input' })
    if (!areLinked(store, me, peer)) return reply.code(403).send({ error: 'not_linked' })
    // 读回执隐私（WhatsApp 语义，仅单聊）：任一方关闭读回执 → **我发出的**消息不向我暴露 readAt（互惠：自己关了
    // 也看不到别人的已读）。只影响"已读/已送达"显示；markRead 照常写库，未读计数/角标完全不受影响。群回执只暴露
    // 匿名计数（readBy/readTotal，不点名谁读了），照 WhatsApp 群例外保持不变。
    const msgs = store.messagesBetween(me, peer, limit, before, beforeId)
    return { messages: withReactions(store, me, msgs.map((m) => stripReadAtForViewer(store, me, m))) }
  })

  // 搜索文本消息：?q=关键词 + (?with=对端 或 ?group=群 id)；**两者都不带=跨会话全局搜索**（WhatsApp 式，
  // "那个地址在哪个对话里"）。鉴权同消息列表（单聊须 accepted 绑定、群须成员；全局的授权边界=本人参与），
  // 不泄漏无权会话的内容。端级限流 60/min（此前无——全局搜索扫全部参与会话更重；与发送同口径，
  // 边输边查有 0.35s 防抖，正常使用远达不到）。
  app.get('/api/messages/search', { preHandler: requireAuth(),
                                    config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
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
    // 不带 with/group → 全局：本人参与的全部单聊 + 所在群（向后兼容：老客户端总带其一，行为不变；
    // 此前该形状是 400 invalid_input，无人依赖一个报错形状）。
    // 读回执剥离与消息列表同口径（复审补漏：搜索是曾被遗漏的 readAt 旁路出口）。
    if (!peer) return { messages: store.searchAllMessagesFor(me, query, limit).map((m) => stripReadAtForViewer(store, me, m)) }
    if (!areLinked(store, me, peer)) return reply.code(403).send({ error: 'not_linked' })
    return { messages: store.searchDirectMessages(me, peer, query, limit).map((m) => stripReadAtForViewer(store, me, m)) }
  })

  // recall/edit/reaction 三个写操作与发送(/api/messages 60/min)**同口径**加端级限流：它们同样每次写库、且
  // 会经会话 last + 客户端轮询播报**触达对方**（盲人侧把编辑/表情/撤回都朗读出来）——只限了发送、放任这三个不限，
  // 等于留了同一"向对方注入内容/刷播报"面的旁路(反复贴表情/连改一条消息可绕过 60/min 刷对方的播报与写库)。补齐三者。
  // 撤回自己发出的消息（WhatsApp 式：双方都看到"已撤回"占位）。限发出后 2 分钟内。视频消息撤回同时删除服务器上的媒体文件。
  app.post('/api/messages/:id/recall', { preHandler: [requireAuth(), requireFeature(store, 'messaging')],
                                         config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
    const id = (req.params as { id: string }).id
    const msg = store.findMessage(id)
    if (!msg) return reply.code(404).send({ error: 'not_found' })
    if (msg.fromId !== req.user!.sub) return reply.code(403).send({ error: 'not_yours' })
    if (Date.now() - msg.createdAt > 2 * 60_000) return reply.code(400).send({ error: 'recall_window_passed' })
    // 纵深防御：撤回视频消息删其媒体，但**绝不删仍被录制实体引用的物理文件**——即便某路径让一条视频消息与
    // 一份录制指向同一 mediaId（发送侧已挡此情形），撤回也不得连带销毁受法务保留/举报证据保护的录制源文件。
    if (msg.kind === 'video' && msg.text !== '' && !store.recordingByMediaId(msg.text)) {
      store.deleteMedia(msg.text)
      removeMediaFile(msg.text)
    }
    const updated = store.updateMessage(id, { kind: 'recalled', text: '', reaction: undefined })
    store.deleteMessageReactions(id) // 撤回连带清逐用户表情（内容已撤，其上的表情也无处依附；与清 reaction 单字段一致）
    // 读回执剥离与消息列表同口径（复审补漏：写操作回显是曾被遗漏的 readAt 旁路出口）。
    return { message: updated && stripReadAtForViewer(store, req.user!.sub, updated) }
  })

  // 编辑自己发出的**文字**消息（WhatsApp 式：改内容 + 标"已编辑"）。限发出后 15 分钟内、仅 text 类。
  // 新内容同样过违禁词（防先发合规再编辑成违禁绕过审核）与长度限制。
  app.post('/api/messages/:id/edit', { preHandler: [requireAuth(), requireFeature(store, 'messaging')],
                                       config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
    const parsed = z.object({ text: z.string().trim().min(1).max(4000) }).safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    const id = (req.params as { id: string }).id
    const msg = store.findMessage(id)
    if (!msg) return reply.code(404).send({ error: 'not_found' })
    if (msg.fromId !== req.user!.sub) return reply.code(403).send({ error: 'not_yours' })
    if (msg.kind !== 'text') return reply.code(400).send({ error: 'not_editable' }) // 仅文字可编辑（媒体/位置/已撤回不可）
    if (Date.now() - msg.createdAt > 15 * 60_000) return reply.code(400).send({ error: 'edit_window_passed' })
    // 可达性复查（与发送/表情回应**完全同口径**）：编辑把**新内容**经会话/群 last 触达对方，必须同样门控——
    // 否则解绑/拉黑后仍能编辑旧消息向对方注入新内容，绕过发送侧 areLinked∧!isBlockedBetween。这是与表情回应
    // block-bypass 修复同源的姊妹缺口（撤回只把内容变"[已撤回]"、不注入新内容，故不需此查）。作者身份上面已验。
    const editor = req.user!.sub
    if (msg.groupId) {
      const group = store.findGroup(msg.groupId)
      if (!group?.memberIds.includes(editor)) return reply.code(403).send({ error: 'not_member' }) // 已退群者不得再改旧消息触达在群成员
    } else {
      if (!areLinked(store, editor, msg.toId)) return reply.code(403).send({ error: 'not_linked' })
      if (isBlockedBetween(store, editor, msg.toId)) return reply.code(403).send({ error: 'blocked' })
    }
    if (matchBannedTerm(store.getAppConfig(), parsed.data.text)) return reply.code(403).send({ error: 'content_blocked' })
    const updated = store.updateMessage(id, { text: parsed.data.text, editedAt: Date.now() })
    // 读回执剥离与消息列表同口径（复审补漏：写操作回显是曾被遗漏的 readAt 旁路出口）。
    return { message: updated && stripReadAtForViewer(store, editor, updated) }
  })

  // 表情回应（WhatsApp 式：单 emoji，最新覆盖；空字符串取消）。单聊双方或群成员可操作。
  app.post('/api/messages/:id/reaction', { preHandler: [requireAuth(), requireFeature(store, 'messaging')],
                                           config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (req, reply) => {
    const parsed = z.object({ emoji: z.string().max(16) }).safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    const id = (req.params as { id: string }).id
    const msg = store.findMessage(id)
    if (!msg) return reply.code(404).send({ error: 'not_found' })
    const me = req.user!.sub
    if (msg.groupId) {
      const group = store.findGroup(msg.groupId)
      if (!group?.memberIds.includes(me)) return reply.code(403).send({ error: 'not_participant' })
    } else {
      if (msg.fromId !== me && msg.toId !== me) return reply.code(403).send({ error: 'not_participant' })
      const other = msg.fromId === me ? msg.toId : msg.fromId
      // 与发送**完全同口径**：可达性 = areLinked ∧ !isBlockedBetween（block-bypass 复审确立的双查铁律）。
      // 此前只补了拉黑、漏了**解绑**：已解除好友关系的人仍能给旧消息贴表情，且经会话列表 last.reaction 触达对方
      // ——发送须 areLinked 却回应不须，是同一可达面上的绕过口子。补齐 areLinked（顺序同发送：先绑定后拉黑）。
      if (!areLinked(store, me, other)) return reply.code(403).send({ error: 'not_linked' })
      if (isBlockedBetween(store, me, other)) return reply.code(403).send({ error: 'blocked' })
    }
    if (msg.kind === 'recalled') return reply.code(400).send({ error: 'message_recalled' })
    const emoji = parsed.data.emoji.trim()
    // 内容审核：reaction 会经会话列表 last.reaction 触达对方，是与消息正文/编辑**同一条**"向对方注入内容"的面
    // （见 edit 门控注"与表情回应同源"）。emoji 字段虽名为表情，schema 却允许 ≤16 字任意文本——不过滤就能塞
    // 一句违禁短语当"表情"绕过发送/编辑侧的 matchBannedTerm 直达对方。补齐审核（正常单个 emoji 不含违禁词、不误伤）。
    if (emoji.length > 0 && matchBannedTerm(store.getAppConfig(), emoji)) return reply.code(403).send({ error: 'content_blocked' })
    // 逐用户回应（每人至多一个 emoji；空=取消本人的）。setMessageReaction 内部**同时**更新旧单字段 message.reaction，
    // 使尚未升级的旧客户端行为完全同今日。回显带上按本人聚合的 reactions（新客户端即时反映自己刚点的态）。
    store.setMessageReaction(id, me, emoji)
    const updated = store.findMessage(id)
    // 读回执剥离与消息列表同口径（对"我发出的"那条才生效；给对端消息贴表情时 readAt 是我自己的已读时刻，非隐私面）。
    return { message: updated && withReactions(store, me, [stripReadAtForViewer(store, me, updated)])[0] }
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
      // 读回执隐私：与消息列表同口径（stripReadAtForViewer 单点）——任一方关了回执，我发的 last 不带 readAt。
      const last = stripReadAtForViewer(store, me, m)
      return {
        // 已注销对端：displayName 留**空串**（语言中立），客户端本地化——不在服务端硬编码中文（同 blocks/call-history）。
        peer: peer ? publicUser(peer) : { id: peerId, username: '', displayName: '', role: '', status: 'disabled', avatar: null },
        last,
        unread: store.unreadCount(me, peerId),
        muted: store.isDmMuted(me, peerId), // 我是否静音了与该对端的单聊（前端显示🔕，免打扰不影响未读）
        // 对端此刻在线/待命（与亲友列表 online 同口径的 presence∨在通话中）：聊天列表也让盲人一眼分清
        // "在线可即时呼叫"与"离线只能留言"，免得进了会话干等——已注销对端恒 false（peer 为 null）。
        online: peer ? isOnline(peerId) : false,
      }
    })
    return { conversations }
  })

  // 单聊免打扰开关（作用于本人，有向）：静音只压该会话的推送横幅——消息照常存库、未读照增，打开即见。
  // 与群免打扰同口径；对端须存在（避免给不存在的会话落垃圾静音）。
  app.post('/api/conversations/:peerId/mute', { preHandler: requireAuth() }, async (req, reply) => {
    const parsed = z.object({ muted: z.boolean() }).safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    const me = req.user!.sub
    const peerId = (req.params as { peerId: string }).peerId
    if (peerId === me || !store.findById(peerId)) return reply.code(404).send({ error: 'not_found' })
    store.setDmMuted(me, peerId, parsed.data.muted)
    return { muted: parsed.data.muted }
  })

  /// 未读汇总（单聊 + 群聊 + 铃铛通知）：供网页标签标题/导航徽标一次性轻量拉取，
  /// 免得为算总数去拉完整会话/群列表。群未读口径与 GET /api/groups 一致。
  app.get('/api/unread', { preHandler: requireAuth() }, async (req) => {
    return totalUnreadFor(store, req.user!.sub)
  })
}
