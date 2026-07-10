import type { FastifyInstance } from 'fastify'
import { randomUUID } from 'node:crypto'
import { createReadStream, statSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { type Store, type MediaMeta, areLinked, isBlockedBetween } from '../db/store'
import { requireAuth } from '../auth/rbac'
import { requireFeature } from '../auth/featureGate'
import { ensureMediaDir, mediaPath, mediaFileExists } from '../media/storage'

/// 单个媒体文件上限 50MB（约 1 分钟 720p H.264）；路由 bodyLimit 略放宽容纳传输开销。
export const MAX_MEDIA_BYTES = 50 * 1024 * 1024

/// 每用户媒体总量配额（默认 2GB，MEDIA_QUOTA_MB 可调，≥1）：单文件上限+限流只限速率不限存量——
/// 10/min×50MB 可持续灌 30GB/小时，已关联消息的媒体不会被孤儿清扫，单账号即可撑爆自托管磁盘。
/// 删除媒体（删消息/解散群/删号级联/孤儿清扫）即时释放额度。
export function mediaQuotaBytes(env: string | undefined = process.env.MEDIA_QUOTA_MB): number {
  const mb = Number(env)
  return (Number.isFinite(mb) && mb >= 1 ? mb : 2048) * 1024 * 1024
}

// iOS 录制/视频消息为 .mov(quicktime)/.mp4；浏览器 MediaRecorder 通话录制为 webm（Chrome）或 mp4（Safari），
// 纯音频录制为 webm/mp4 音频。都需接受，否则网页端录制上传被拒、无法保存（见录制反馈）。
const allowedMimes = new Set(['video/mp4', 'video/quicktime', 'video/webm', 'audio/webm', 'audio/mp4'])
const mediaContentTypes = ['video/mp4', 'video/quicktime', 'video/webm', 'audio/webm', 'audio/mp4']

/// 媒体上传/下载（视频消息）：实体文件存服务器磁盘（自托管，不依赖外部对象存储）。
/// 上传：POST /api/media，请求体为原始二进制（Content-Type: video/mp4 或 video/quicktime）。
/// 下载：GET /api/media/:id，仅本人 / 好友 / 同群成员可取（消息可达性 = 文件可达性）。
export function registerMediaRoutes(app: FastifyInstance, store: Store): void {
  // 在途（写盘中）字节的每用户预留：mediaBytesForOwner 只反映**已落库**媒体，而配额检查(同步)与 createMedia
  // (在 await writeFile **之后**) 被写盘隔开——并发上传会各自在提交前通过检查、合计越 2GB 配额（同 vision 配额的
  // TOCTOU，见 314597e）。把并发中的上传也计入检查：检查+预留相邻同步→原子占额；写完/写失败都在 finally 释放
  // （成功已转入已落库计数、失败不占）。map 仅在有在途上传时驻留、归零即删，无泄漏。
  const pendingBytes = new Map<string, number>()
  // 媒体二进制按 Buffer 接收（仅这些 content-type 走此解析器，不影响 JSON 路由）。
  // 字符串匹配按前缀生效，故 'video/webm;codecs=vp9,opus' 等带 codecs 参数的也会命中。
  app.addContentTypeParser(mediaContentTypes,
    { parseAs: 'buffer', bodyLimit: MAX_MEDIA_BYTES + 1024 * 1024 },
    (_req, body, done) => done(null, body))

  /// 是否与 owner 同在任一群。
  function sharesGroup(me: string, owner: string): boolean {
    return store.groupsFor(me).some((g) => g.memberIds.includes(owner))
  }

  /// 精确授权兜底：能否看该媒体 = 能否看引用它的那条消息。修"发送者退群/解除好友后，
  /// 历史里仍在的视频对其余可见者却 403"——上面 areLinked/sharesGroup 是按"与 owner 现有关系"
  /// 的近似，owner 一旦退群/解绑就失效，但消息（及其媒体）本应对仍能看到该消息的人保持可见。
  /// 仅在前两条廉价判定都不成立时才查（短路），故对常见路径无开销。
  function sharedViaVisibleMessage(me: string, mediaId: string): boolean {
    const msg = store.findVideoMessageByMediaId(mediaId)
    if (!msg) return false
    if (msg.groupId) { const g = store.findGroup(msg.groupId); return !!g && g.memberIds.includes(me) }
    return msg.fromId === me || msg.toId === me // 单聊：收发双方任一
  }

  app.post('/api/media', { preHandler: [requireAuth(), requireFeature(store, 'mediaUpload')],
                           bodyLimit: MAX_MEDIA_BYTES + 1024 * 1024,
                           config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const mime = (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase()
    if (!allowedMimes.has(mime)) return reply.code(415).send({ error: 'unsupported_media_type' })
    const body = req.body as Buffer | undefined
    if (!body || !Buffer.isBuffer(body) || body.length === 0) return reply.code(400).send({ error: 'invalid_input' })
    if (body.length > MAX_MEDIA_BYTES) return reply.code(413).send({ error: 'media_too_large' })
    // 总量配额：与"单文件过大"区分错误码，客户端可提示"清理旧视频消息"而非"换小文件"。
    // 检查须计入**在途**上传（pendingBytes）：检查 + 预留相邻、其间无 await → 原子占额，并发的下一个上传必看到本次
    // 占用而被挡（此前 createMedia 在 await 之后才计数，边界并发可越额）。
    const sub = req.user!.sub
    const reserved = pendingBytes.get(sub) ?? 0
    if (store.mediaBytesForOwner(sub) + reserved + body.length > mediaQuotaBytes()) {
      return reply.code(413).send({ error: 'media_quota_exceeded' })
    }
    pendingBytes.set(sub, reserved + body.length) // 原子预留（与上面的检查相邻、其间无 await）

    try {
      const meta: MediaMeta = { id: randomUUID(), ownerId: sub, mime, size: body.length, createdAt: Date.now() }
      ensureMediaDir()
      // 异步落盘（非 writeFileSync）：单文件最大 50MB，同步写会**阻塞事件循环**——写盘期间整个服务不处理任何
      // 其它请求（含紧急呼叫/求助），并发上传更会串行叠加成秒级停顿。async writeFile 交给 libuv 线程池，事件循环
      // 期间照常服务。await 保证写完再 createMedia（顺序不变）；写失败(磁盘满等)照旧抛出→500，不落半条 media 记录。
      await writeFile(mediaPath(meta.id), body)
      store.createMedia(meta) // 字节已转入已落库计数（mediaBytesForOwner）
      return reply.code(201).send({ media: meta })
    } finally {
      // 释放预留：成功时字节已入 mediaBytesForOwner、失败时不占额。createMedia→finally 同步相邻，无并发可见"双计"窗口。
      const rem = (pendingBytes.get(sub) ?? 0) - body.length
      if (rem > 0) pendingBytes.set(sub, rem); else pendingBytes.delete(sub)
    }
  })

  app.get('/api/media/:id', { preHandler: requireAuth() }, async (req, reply) => {
    const id = (req.params as { id: string }).id
    const meta = store.findMedia(id)
    if (!meta || !mediaFileExists(meta.id)) return reply.code(404).send({ error: 'not_found' })
    // 通话录制的媒体严禁经此通用端点（好友/同群授权 + 不识别软删除）外泄——
    // 录制捕获了被录方音视频，必须走录制作用域端点（owner∨admin，且尊重 deletedAt）。返回 404 不泄漏存在性。
    if (store.recordingByMediaId(id)) return reply.code(404).send({ error: 'not_found' })
    const me = req.user!.sub
    // 授权三条（任一即可）：①本人；②经**可见消息**共享（能看到引用它的那条消息就能看媒体——无条件，
    //   即便之后互相拉黑，历史消息仍可见）；③好友/同群的"便捷取"（凭现有关系按 UUID 直取），
    //   但便捷取须**未互相拉黑**——拉黑不解绑（areLinked 仍 true），若不额外查 isBlockedBetween，被拉黑者可凭
    //   旧绑定拉取对方**未发给自己**的媒体 UUID，绕过黑名单（与建群/加人/单聊同口径）。
    const viaRelationship = (areLinked(store, me, meta.ownerId) || sharesGroup(me, meta.ownerId))
      && !isBlockedBetween(store, me, meta.ownerId)
    if (me !== meta.ownerId && !sharedViaVisibleMessage(me, id) && !viaRelationship) {
      return reply.code(403).send({ error: 'forbidden' })
    }
    const path = mediaPath(meta.id)
    reply.header('content-type', meta.mime)
    reply.header('content-length', String(statSync(path).size))
    return reply.send(createReadStream(path))
  })
}
