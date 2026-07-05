import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { createReadStream, statSync } from 'node:fs'
import { type Store, type Recording, type User } from '../db/store'
import { requireAuth, blockedByVerificationGate } from '../auth/rbac'
import { sweepExpiredRecordings } from '../recording/retention'
import { removeMediaFile, mediaPath, mediaFileExists } from '../media/storage'
import { RecordingConsentRegistry } from '../recording/consentRegistry'
import { type PendingCallRegistry } from '../assist/pendingCalls'
import { type OpenHelpRegistry } from '../assist/openHelp'
import { verifyAccessToken, signMediaToken, verifyMediaToken, MEDIA_TOKEN_TTL_SEC } from '../auth/tokens'

const configSchema = z.object({
  enabled: z.boolean().optional(),
  retentionDays: z.number().int().min(1).max(3650).optional(),
  requireConsent: z.boolean().optional(),
})

const createSchema = z.object({
  callId: z.string().min(1),
  reason: z.string().max(200).optional(),
  mediaId: z.string().min(1).optional(), // 录制实体（先经 /api/media 上传 .mov 拿到），可选
  // 详细元数据（"时间地点人+时长"，时间/人由服务端权威，时长/位置由客户端采集）：
  durationSec: z.number().int().min(0).max(86_400).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lon: z.number().min(-180).max(180).optional(),
  locationLabel: z.string().max(200).optional(),
})

const consentSchema = z.object({ callId: z.string().min(1), granted: z.boolean() })

export function registerRecordingRoutes(app: FastifyInstance, store: Store, consent: RecordingConsentRegistry,
                                        pendingCalls: PendingCallRegistry, openHelp: OpenHelpRegistry): void {
  const adminOnly = { preHandler: requireAuth(['admin']) }

  /// 解析参与者 userId → 展示名（缺失/已删用户回退为 '(unknown)'）。
  const nameOf = (id: string): string => store.findById(id)?.displayName ?? '(unknown)'

  /// 把一条录制元数据序列化给客户端/后台（含解析后的参与者名、媒体是否仍在）。
  const presentRecording = (r: Recording) => {
    const participantIds = r.participants ?? Array.from(new Set([r.ownerId, ...r.consentBy]))
    return {
      id: r.id,
      callId: r.callId,
      ownerId: r.ownerId,
      ownerName: nameOf(r.ownerId),
      reason: r.reason,
      recordedAt: r.recordedAt,
      durationSec: r.durationSec ?? null,
      lat: r.lat ?? null,
      lon: r.lon ?? null,
      locationLabel: r.locationLabel ?? null,
      participantIds,
      participantNames: participantIds.map(nameOf),
      hasMedia: !!(r.mediaId && mediaFileExists(r.mediaId)),
      deletedAt: r.deletedAt ?? null,        // 管理员视图据此标注"用户已删除·留存中"
    }
  }

  // 被录方授予/撤回录制同意（服务端权威）：录制登记时据此核验，不信任发起者自报的同意。
  app.post('/api/recordings/consent', { preHandler: requireAuth() }, async (req, reply) => {
    const parsed = consentSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    // 只有该通话的**真实参与者**才能就此 callId 授予同意——否则任意登录用户可为自己不在的通话伪造同意，
    // 让发起者+串通的第三方在被录方不知情下录制（见录制评审 high）。与 ws.ts join 同一参与权校验。
    const now = Date.now()
    const me = req.user!.sub
    const callId = parsed.data.callId
    const inRegistry = (pendingCalls.participants(callId, now) ?? openHelp.participants(callId, now))?.includes(me) ?? false
    const inCallRecord = store.callRecordsForUser(me).some((r) => r.callId === callId)
    if (!inRegistry && !inCallRecord) {
      return reply.code(403).send({ error: 'not_a_participant' })
    }
    if (parsed.data.granted) consent.grant(parsed.data.callId, req.user!.sub, now)
    else consent.revoke(parsed.data.callId, req.user!.sub)
    return { ok: true }
  })

  app.get('/api/recordings/config', adminOnly, async () => store.getRecordingConfig())

  app.put('/api/recordings/config', adminOnly, async (req, reply) => {
    const parsed = configSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    return store.setRecordingConfig(parsed.data)
  })

  // 创建一条录制元数据。默认关闭；开启后仍需满足知情同意。
  app.post('/api/recordings', { preHandler: requireAuth() }, async (req, reply) => {
    const cfg = store.getRecordingConfig()
    if (!cfg.enabled) return reply.code(403).send({ error: 'recording_disabled' })
    const parsed = createSchema.safeParse(req.body)
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_input' })
    const owner = req.user!
    // 知情同意**服务端权威**：consentBy 由服务端从同意登记表取（被录方经鉴权端点亲自授予），
    // 而非信任发起者自报——杜绝被改造客户端伪造对端同意。要求至少有一名非发起者的有效同意。
    const consenters = consent.consenters(parsed.data.callId, owner.sub, Date.now())
    if (cfg.requireConsent && consenters.length === 0) {
      return reply.code(400).send({ error: 'consent_required' })
    }
    // mediaId 必须是上传者本人的媒体（防把他人媒体挂到自己的录制上）。
    if (parsed.data.mediaId) {
      const media = store.findMedia(parsed.data.mediaId)
      if (!media || media.ownerId !== owner.sub) return reply.code(400).send({ error: 'invalid_media' })
    }
    // 参与者（"人"）= 发起者 + 服务端核验的同意者，去重持久化（同意登记表是易失内存，这里落库）。
    const participants = Array.from(new Set([owner.sub, ...consenters]))
    const rec: Recording = {
      id: randomUUID(),
      callId: parsed.data.callId,
      ownerId: owner.sub,
      consentBy: consenters, // 服务端核验后的真实同意者
      reason: parsed.data.reason ?? '',
      recordedAt: Date.now(),
      mediaId: parsed.data.mediaId,
      participants,
      durationSec: parsed.data.durationSec,
      lat: parsed.data.lat,
      lon: parsed.data.lon,
      locationLabel: parsed.data.locationLabel,
    }
    store.createRecording(rec)
    return reply.code(201).send({ recording: rec })
  })

  // —— 用户端"我的录音"：仅本人作为录制者(owner)的、未被本人删除的录制 ——
  app.get('/api/recordings/mine', { preHandler: requireAuth() }, async (req) => {
    const list = store.recordingsForUser(req.user!.sub)
    return { recordings: list.map(presentRecording) }
  })

  // 用户软删除自己的录制：仅置 deletedAt（对其隐藏），**不**删媒体文件——
  // 管理员在留存期内仍可查看（合规/取证）；真正的物理清除由 sweepExpiredRecordings 在到期时执行。
  app.delete('/api/recordings/mine/:id', { preHandler: requireAuth() }, async (req, reply) => {
    const id = (req.params as { id: string }).id
    const rec = store.findRecording(id)
    if (!rec) return reply.code(404).send({ error: 'not_found' })
    if (rec.ownerId !== req.user!.sub) return reply.code(403).send({ error: 'forbidden' }) // 只能删自己的
    if (rec.deletedAt != null) return reply.code(204).send() // 幂等
    store.updateRecording(id, { deletedAt: Date.now() })
    return reply.code(204).send()
  })

  // —— 录制媒体播放（流式，支持 HTTP Range 便于拖动；与通用 /api/media 的好友/同群授权隔离）——
  // 授权（录制作用域）：拥有者本人（且未被本人删除）或管理员（即使已软删除——合规留存可看）。
  // 鉴权两条路：① Authorization: Bearer（App）② 短时签名 ?t= 媒体令牌（Web <video> 不能带头）。
  app.get('/api/recordings/:id/media', async (req, reply) => {
    const id = (req.params as { id: string }).id
    const rec = store.findRecording(id)
    if (!rec || !rec.mediaId) return reply.code(404).send({ error: 'not_found' })
    const ident = identify(req, id)
    if (!ident) return reply.code(401).send({ error: 'unauthorized' })
    // 实名认证门禁：此路不走 requireAuth(自带鉴权)，故在此显式施加同一门禁，防经媒体流端点绕过（见复审 BYPASS-MED）。
    if (store.getAppConfig().requireVerification && blockedByVerificationGate(ident.user.role, ident.user.identityVerified, undefined)) {
      return reply.code(403).send({ error: 'verification_required' })
    }
    const isAdmin = ident.user.role === 'admin'
    const isOwner = rec.ownerId === ident.user.id
    // 拥有者已软删除则其本人不可再看（与"已删除"语义一致）；管理员不受 deletedAt 限制。
    if (!(isAdmin || (isOwner && rec.deletedAt == null))) return reply.code(403).send({ error: 'forbidden' })
    if (!mediaFileExists(rec.mediaId)) return reply.code(404).send({ error: 'not_found' })
    const media = store.findMedia(rec.mediaId)
    const mime = media?.mime ?? 'video/quicktime'
    // 管理员查看留痕（尤其是查看用户已软删除的录制——可追责）。
    if (isAdmin && !isOwner) {
      store.createAuditEntry({ id: randomUUID(), adminId: ident.user.id, action: 'recording.view', targetType: 'recording', targetId: id, detail: rec.deletedAt != null ? 'user-deleted (legal hold)' : undefined, at: Date.now() })
    }
    return streamWithRange(req, reply, mediaPath(rec.mediaId), mime)
  })

  // 为 Web 播放铸造短时媒体令牌（App 直接用 Bearer 下载，不需此端点）。
  // GET：纯读（仅签名，无副作用），且避免"空 body + application/json"被 Fastify 拒为 400。
  app.get('/api/recordings/:id/play-token', { preHandler: requireAuth() }, async (req, reply) => {
    const id = (req.params as { id: string }).id
    const rec = store.findRecording(id)
    if (!rec || !rec.mediaId) return reply.code(404).send({ error: 'not_found' })
    const me = req.user!
    const isAdmin = me.role === 'admin'
    const isOwner = rec.ownerId === me.sub
    if (!(isAdmin || (isOwner && rec.deletedAt == null))) return reply.code(403).send({ error: 'forbidden' })
    // 绑定当前 tokenVersion：改密/封禁/强制下线后旧令牌即失效（与 Bearer 路一致，见复审 MED-2）。
    return { token: signMediaToken({ sub: me.sub, role: me.role, rec: id, tv: me.tv ?? 0, sid: me.sid }), expiresInSec: MEDIA_TOKEN_TTL_SEC }
  })

  // 列出录制（管理员，含用户已软删除项）。先清过期项：删元数据 + 级联删媒体文件。
  app.get('/api/recordings', adminOnly, async () => {
    const purged = sweepExpiredRecordings(store, Date.now())
    return { recordings: store.allRecordings().map(presentRecording), purged }
  })

  app.delete('/api/recordings/:id', adminOnly, async (req, reply) => {
    const id = (req.params as { id: string }).id
    const rec = store.findRecording(id)
    if (!rec) return reply.code(404).send({ error: 'not_found' })
    // 取证留存：被未结举报引用为证据的录制不可手动真删（与自动清理一致，杜绝调查期间证据被销毁，见复审 LOW-4）。
    if (store.reportsCitingRecording(id).some((r) => r.status !== 'resolved')) {
      return reply.code(409).send({ error: 'evidence_held' })
    }
    if (rec.mediaId) { removeMediaFile(rec.mediaId); store.deleteMedia(rec.mediaId) } // 级联删媒体（真删）
    store.deleteRecording(id)
    // 审计：录制的物理销毁须可追责。
    store.createAuditEntry({ id: randomUUID(), adminId: req.user!.sub, action: 'recording.delete', targetType: 'recording', targetId: id, at: Date.now() })
    return reply.code(204).send()
  })

  /// 鉴权：优先 Authorization: Bearer（App），否则 ?t= 短时媒体令牌（Web）。
  /// 两条路都要回库核验用户存在且 active、且（Bearer 路）tokenVersion 未失效（封禁/改密即失效）。
  function identify(req: FastifyRequest, recordingId: string): { user: User } | null {
    const authz = req.headers.authorization
    if (typeof authz === 'string' && authz.startsWith('Bearer ')) {
      const p = verifyAccessToken(authz.slice(7))
      if (p) {
        const u = store.findById(p.sub)
        // 会话级撤销：按设备远程登出后旧 access token 即失效（与 requireAuth 一致，见复审 SESSION-LOW）。
        if (u && u.status === 'active' && (u.tokenVersion ?? 0) === (p.tv ?? 0)
            && (!p.sid || store.hasActiveSession(p.sub, p.sid, Date.now()))) return { user: u }
      }
    }
    const t = (req.query as { t?: string }).t
    if (typeof t === 'string' && t) {
      const mt = verifyMediaToken(t, recordingId)
      if (mt) {
        const u = store.findById(mt.sub)
        // 校验 tokenVersion（改密/封禁/强制下线即失效，见复审 MED-2）+ **会话**（按设备远程登出即失效，与
        // Bearer 路同口径——此前媒体令牌只查 tv、不查 session，登出某设备后其旧媒体令牌仍可播至 60s TTL 到期）。
        // sid 缺省（旧令牌）回退只查 tv，向后兼容。
        if (u && u.status === 'active' && (u.tokenVersion ?? 0) === (mt.tv ?? 0)
            && (!mt.sid || store.hasActiveSession(mt.sub, mt.sid, Date.now()))) return { user: u }
      }
    }
    return null
  }
}

/// 以 HTTP Range 流式发送一个文件（206 局部内容 / 200 全量），便于播放器拖动进度。
/// 校验并钳制 start/end，非法/不可满足的区间返回 416。文件名是服务端生成的 UUID（无路径穿越）。
function streamWithRange(req: FastifyRequest, reply: FastifyReply, path: string, mime: string): FastifyReply {
  const size = statSync(path).size
  reply.header('Accept-Ranges', 'bytes')
  reply.header('Content-Type', mime)
  reply.header('Cache-Control', 'private, no-store')
  const range = req.headers.range
  if (typeof range === 'string') {
    const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim())
    if (!m || (m[1] === '' && m[2] === '')) {
      return reply.code(416).header('Content-Range', `bytes */${size}`).send()
    }
    let start = m[1] === '' ? size - Number(m[2]) : Number(m[1])
    // 后缀区间 bytes=-N（最后 N 字节）：start=size-N、end 必须是 size-1，而非 N——
    // 否则如 bytes=-500 在 10000 字节文件上得 start=9500/end=500，被下方 start>end 误判 416。
    // 这类后缀请求合法且 MOV/MP4 播放器常用（读片尾 moov 原子）。
    let end = (m[2] === '' || m[1] === '') ? size - 1 : Number(m[2])
    if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0) start = 0
    if (end >= size) end = size - 1
    if (start > end || start >= size) {
      return reply.code(416).header('Content-Range', `bytes */${size}`).send()
    }
    reply.code(206)
    reply.header('Content-Range', `bytes ${start}-${end}/${size}`)
    reply.header('Content-Length', String(end - start + 1))
    return reply.send(createReadStream(path, { start, end }))
  }
  reply.header('Content-Length', String(size))
  return reply.send(createReadStream(path))
}
