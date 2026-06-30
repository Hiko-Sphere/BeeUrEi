import type { FastifyInstance } from 'fastify'
import { randomUUID } from 'node:crypto'
import { writeFileSync, createReadStream, statSync } from 'node:fs'
import { type Store, type MediaMeta, areLinked } from '../db/store'
import { requireAuth } from '../auth/rbac'
import { requireFeature } from '../auth/featureGate'
import { ensureMediaDir, mediaPath, mediaFileExists } from '../media/storage'

/// 单个媒体文件上限 50MB（约 1 分钟 720p H.264）；路由 bodyLimit 略放宽容纳传输开销。
export const MAX_MEDIA_BYTES = 50 * 1024 * 1024

// iOS 录制/视频消息为 .mov(quicktime)/.mp4；浏览器 MediaRecorder 通话录制为 webm（Chrome）或 mp4（Safari），
// 纯音频录制为 webm/mp4 音频。都需接受，否则网页端录制上传被拒、无法保存（见录制反馈）。
const allowedMimes = new Set(['video/mp4', 'video/quicktime', 'video/webm', 'audio/webm', 'audio/mp4'])
const mediaContentTypes = ['video/mp4', 'video/quicktime', 'video/webm', 'audio/webm', 'audio/mp4']

/// 媒体上传/下载（视频消息）：实体文件存服务器磁盘（自托管，不依赖外部对象存储）。
/// 上传：POST /api/media，请求体为原始二进制（Content-Type: video/mp4 或 video/quicktime）。
/// 下载：GET /api/media/:id，仅本人 / 好友 / 同群成员可取（消息可达性 = 文件可达性）。
export function registerMediaRoutes(app: FastifyInstance, store: Store): void {
  // 媒体二进制按 Buffer 接收（仅这些 content-type 走此解析器，不影响 JSON 路由）。
  // 字符串匹配按前缀生效，故 'video/webm;codecs=vp9,opus' 等带 codecs 参数的也会命中。
  app.addContentTypeParser(mediaContentTypes,
    { parseAs: 'buffer', bodyLimit: MAX_MEDIA_BYTES + 1024 * 1024 },
    (_req, body, done) => done(null, body))

  /// 是否与 owner 同在任一群。
  function sharesGroup(me: string, owner: string): boolean {
    return store.groupsFor(me).some((g) => g.memberIds.includes(owner))
  }

  app.post('/api/media', { preHandler: [requireAuth(), requireFeature(store, 'mediaUpload')],
                           bodyLimit: MAX_MEDIA_BYTES + 1024 * 1024,
                           config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (req, reply) => {
    const mime = (req.headers['content-type'] ?? '').split(';')[0].trim().toLowerCase()
    if (!allowedMimes.has(mime)) return reply.code(415).send({ error: 'unsupported_media_type' })
    const body = req.body as Buffer | undefined
    if (!body || !Buffer.isBuffer(body) || body.length === 0) return reply.code(400).send({ error: 'invalid_input' })
    if (body.length > MAX_MEDIA_BYTES) return reply.code(413).send({ error: 'media_too_large' })

    const meta: MediaMeta = { id: randomUUID(), ownerId: req.user!.sub, mime, size: body.length, createdAt: Date.now() }
    ensureMediaDir()
    writeFileSync(mediaPath(meta.id), body)
    store.createMedia(meta)
    return reply.code(201).send({ media: meta })
  })

  app.get('/api/media/:id', { preHandler: requireAuth() }, async (req, reply) => {
    const id = (req.params as { id: string }).id
    const meta = store.findMedia(id)
    if (!meta || !mediaFileExists(meta.id)) return reply.code(404).send({ error: 'not_found' })
    // 通话录制的媒体严禁经此通用端点（好友/同群授权 + 不识别软删除）外泄——
    // 录制捕获了被录方音视频，必须走录制作用域端点（owner∨admin，且尊重 deletedAt）。返回 404 不泄漏存在性。
    if (store.recordingByMediaId(id)) return reply.code(404).send({ error: 'not_found' })
    const me = req.user!.sub
    if (me !== meta.ownerId && !areLinked(store, me, meta.ownerId) && !sharesGroup(me, meta.ownerId)) {
      return reply.code(403).send({ error: 'forbidden' })
    }
    const path = mediaPath(meta.id)
    reply.header('content-type', meta.mime)
    reply.header('content-length', String(statSync(path).size))
    return reply.send(createReadStream(path))
  })
}
