import { describe, it, expect, beforeAll } from 'vitest'
import { randomUUID } from 'node:crypto'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildApp } from '../src/app'
import { MemoryStore, type User } from '../src/db/store'
import { hashPassword } from '../src/auth/passwords'
import { sweepExpiredRecordings } from '../src/recording/retention'

// 媒体落盘到临时目录，避免污染 data/media。storage.mediaDir() 在调用时读 env，故启动前设置即可。
beforeAll(() => { process.env.MEDIA_DIR = mkdtempSync(join(tmpdir(), 'beeurei-rec-')) })

function admin(): User {
  return { id: 'admin1', username: 'root', passwordHash: hashPassword('rootpass1'), displayName: 'root', role: 'admin', status: 'active', createdAt: Date.now() }
}
const auth = (t: string) => ({ authorization: `Bearer ${t}` })

async function adminToken(app: ReturnType<typeof buildApp>) {
  return (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'root', password: 'rootpass1' } })).json().token as string
}
async function reg(app: ReturnType<typeof buildApp>, username: string) {
  const r = (await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username, password: 'secret123' } })).json()
  return { token: r.token as string, id: r.user.id as string }
}
async function setupCall(app: ReturnType<typeof buildApp>, store: MemoryStore, callerToken: string, callerId: string, peerId: string, callId: string) {
  store.createLink({ id: randomUUID(), ownerId: callerId, memberId: peerId, relation: 'friend', isEmergency: false, status: 'accepted', createdAt: Date.now() })
  await app.inject({ method: 'POST', url: '/api/assist/call', headers: auth(callerToken), payload: { callId, targetUserIds: [peerId] } })
}
async function uploadMedia(app: ReturnType<typeof buildApp>, token: string, bytes: Buffer) {
  const r = await app.inject({ method: 'POST', url: '/api/media', headers: { ...auth(token), 'content-type': 'video/mp4' }, payload: bytes })
  return r.json().media.id as string
}

/** 完整建一条可播放录制：开录制策略→建通话→对端同意→上传媒体→POST /api/recordings(带元数据)。 */
async function makeRecording(opts: { withMedia?: boolean; duration?: number; lat?: number; lon?: number } = {}) {
  const store = new MemoryStore()
  store.createUser(admin())
  const app = buildApp(store)
  const at = await adminToken(app)
  await app.inject({ method: 'PUT', url: '/api/recordings/config', headers: auth(at), payload: { enabled: true, requireConsent: true, retentionDays: 7 } })
  const owner = await reg(app, 'owneruser')
  const peer = await reg(app, 'peeruser')
  await setupCall(app, store, owner.token, owner.id, peer.id, 'call1')
  await app.inject({ method: 'POST', url: '/api/recordings/consent', headers: auth(peer.token), payload: { callId: 'call1', granted: true } })
  let mediaId: string | undefined
  let bytes: Buffer | undefined
  if (opts.withMedia !== false) {
    bytes = Buffer.from('FAKE-MOV-BYTES-0123456789-abcdefghijklmnopqrstuvwxyz')
    mediaId = await uploadMedia(app, owner.token, bytes)
  }
  const create = await app.inject({
    method: 'POST', url: '/api/recordings', headers: auth(owner.token),
    payload: { callId: 'call1', reason: 'evidence', mediaId, durationSec: opts.duration ?? 73, lat: opts.lat ?? 35.68, lon: opts.lon ?? 139.69, locationLabel: 'Tokyo' },
  })
  return { store, app, at, owner, peer, recording: create.json().recording, mediaBytes: bytes }
}

describe('录制详细元数据', () => {
  it('创建时落库 时间/人/时长/位置；participants = 发起者 + 同意者', async () => {
    const { app, owner, peer, recording } = await makeRecording({ duration: 120, lat: 1.5, lon: 2.5 })
    expect(recording.recordedAt).toBeTypeOf('number')
    expect(recording.durationSec).toBe(120)
    expect(recording.lat).toBe(1.5)
    expect(recording.lon).toBe(2.5)
    expect(recording.locationLabel).toBe('Tokyo')
    expect(recording.participants.sort()).toEqual([owner.id, peer.id].sort())
    expect(recording.consentBy).toEqual([peer.id])
    await app.close()
  })
})

describe('用户端"我的录音" + 软删除 + 管理员留存', () => {
  it('owner 在 /mine 看到自己的录制（含参与者名）；对端看不到（非 owner）', async () => {
    const { app, owner, peer, recording } = await makeRecording()
    const mine = await app.inject({ method: 'GET', url: '/api/recordings/mine', headers: auth(owner.token) })
    expect(mine.statusCode).toBe(200)
    expect(mine.json().recordings.length).toBe(1)
    const r = mine.json().recordings[0]
    expect(r.id).toBe(recording.id)
    expect(r.participantNames).toContain('owneruser')
    expect(r.participantNames).toContain('peeruser')
    expect(r.hasMedia).toBe(true)
    // 对端（被录方）不是 owner → 其 /mine 不含此录制。
    const peerMine = await app.inject({ method: 'GET', url: '/api/recordings/mine', headers: auth(peer.token) })
    expect(peerMine.json().recordings.length).toBe(0)
    await app.close()
  })

  it('owner 软删除 → 自己 /mine 消失；管理员列表仍可见且标注 deletedAt（合规留存）', async () => {
    const { app, at, owner, recording } = await makeRecording()
    const del = await app.inject({ method: 'DELETE', url: `/api/recordings/mine/${recording.id}`, headers: auth(owner.token) })
    expect(del.statusCode).toBe(204)
    const mine = await app.inject({ method: 'GET', url: '/api/recordings/mine', headers: auth(owner.token) })
    expect(mine.json().recordings.length).toBe(0) // 对用户隐藏
    const adminList = await app.inject({ method: 'GET', url: '/api/recordings', headers: auth(at) })
    const row = adminList.json().recordings.find((x: any) => x.id === recording.id)
    expect(row).toBeTruthy()             // 管理员仍可见
    expect(row.deletedAt).toBeTruthy()   // 标注"用户已删除·留存中"
    await app.close()
  })

  it('非 owner 不能软删除他人录制（403）', async () => {
    const { app, peer, recording } = await makeRecording()
    const del = await app.inject({ method: 'DELETE', url: `/api/recordings/mine/${recording.id}`, headers: auth(peer.token) })
    expect(del.statusCode).toBe(403)
    await app.close()
  })
})

describe('录制媒体播放（流式 + 授权 + Range）', () => {
  it('owner 用 Bearer 可播放，返回 Accept-Ranges；陌生人 403；无鉴权 401', async () => {
    const { app, owner, recording, mediaBytes } = await makeRecording()
    const stranger = await reg(app, 'stranger')
    const ok = await app.inject({ method: 'GET', url: `/api/recordings/${recording.id}/media`, headers: auth(owner.token) })
    expect(ok.statusCode).toBe(200)
    expect(ok.headers['accept-ranges']).toBe('bytes')
    expect(ok.rawPayload.length).toBe(mediaBytes!.length)
    const forbidden = await app.inject({ method: 'GET', url: `/api/recordings/${recording.id}/media`, headers: auth(stranger.token) })
    expect(forbidden.statusCode).toBe(403)
    const noauth = await app.inject({ method: 'GET', url: `/api/recordings/${recording.id}/media` })
    expect(noauth.statusCode).toBe(401)
    await app.close()
  })

  it('Range 请求返回 206 + Content-Range + 局部字节', async () => {
    const { app, owner, recording, mediaBytes } = await makeRecording()
    const r = await app.inject({ method: 'GET', url: `/api/recordings/${recording.id}/media`, headers: { ...auth(owner.token), range: 'bytes=0-3' } })
    expect(r.statusCode).toBe(206)
    expect(r.headers['content-range']).toBe(`bytes 0-3/${mediaBytes!.length}`)
    expect(r.rawPayload.length).toBe(4)
    // 不可满足的区间 → 416。
    const bad = await app.inject({ method: 'GET', url: `/api/recordings/${recording.id}/media`, headers: { ...auth(owner.token), range: `bytes=${mediaBytes!.length + 10}-` } })
    expect(bad.statusCode).toBe(416)
    await app.close()
  })

  it('后缀区间 bytes=-N（最后 N 字节）正确返回片尾，而非误判 416', async () => {
    const { app, owner, recording, mediaBytes } = await makeRecording()
    const n = mediaBytes!.length
    // 最后 3 字节：start=n-3, end=n-1, 长度 3。曾因 end 被误设为 3 → start>end → 错判 416。
    const suffix = await app.inject({ method: 'GET', url: `/api/recordings/${recording.id}/media`, headers: { ...auth(owner.token), range: 'bytes=-3' } })
    expect(suffix.statusCode).toBe(206)
    expect(suffix.headers['content-range']).toBe(`bytes ${n - 3}-${n - 1}/${n}`)
    expect(suffix.rawPayload.length).toBe(3)
    // 后缀长度超过文件 → start 截到 0，返回整个文件（仍 206）。
    const big = await app.inject({ method: 'GET', url: `/api/recordings/${recording.id}/media`, headers: { ...auth(owner.token), range: `bytes=-${n + 100}` } })
    expect(big.statusCode).toBe(206)
    expect(big.headers['content-range']).toBe(`bytes 0-${n - 1}/${n}`)
    await app.close()
  })

  it('管理员可播放，即使 owner 已软删除（留存取证）；owner 本人软删除后不可再播', async () => {
    const { app, at, owner, recording } = await makeRecording()
    await app.inject({ method: 'DELETE', url: `/api/recordings/mine/${recording.id}`, headers: auth(owner.token) })
    const adminPlay = await app.inject({ method: 'GET', url: `/api/recordings/${recording.id}/media`, headers: auth(at) })
    expect(adminPlay.statusCode).toBe(200)
    const ownerPlay = await app.inject({ method: 'GET', url: `/api/recordings/${recording.id}/media`, headers: auth(owner.token) })
    expect(ownerPlay.statusCode).toBe(403) // 已删除对其本人不可见
    await app.close()
  })

  it('play-token 用于 Web <video>：?t= 可播；令牌严格绑定单个录制', async () => {
    const { app, owner, recording } = await makeRecording()
    const tokenRes = await app.inject({ method: 'GET', url: `/api/recordings/${recording.id}/play-token`, headers: auth(owner.token) })
    expect(tokenRes.statusCode).toBe(200)
    const tk = tokenRes.json().token as string
    const play = await app.inject({ method: 'GET', url: `/api/recordings/${recording.id}/media?t=${encodeURIComponent(tk)}` })
    expect(play.statusCode).toBe(200)
    // 同一 token 用在另一个 recId 上 → 拒绝（作用域不匹配；该 id 不存在故 404，但关键是不放行）。
    const wrong = await app.inject({ method: 'GET', url: `/api/recordings/${randomUUID()}/media?t=${encodeURIComponent(tk)}` })
    expect([401, 404]).toContain(wrong.statusCode)
    await app.close()
  })
})

describe('举报附录制证据', () => {
  it('参与者可附证据；非参与者附他人录制 → invalid_evidence', async () => {
    const { app, owner, peer, recording } = await makeRecording()
    // owner 举报 peer 并附该录制（owner 是参与者）→ 成功带证据。
    const ok = await app.inject({ method: 'POST', url: '/api/reports', headers: auth(owner.token), payload: { targetUserId: peer.id, callId: 'call1', reason: 'abuse', evidenceRecordingId: recording.id } })
    expect(ok.statusCode).toBe(201)
    expect(ok.json().report.evidenceRecordingId).toBe(recording.id)
    // 陌生人附该录制（非参与者）→ 400 invalid_evidence。
    const stranger = await reg(app, 'stranger2')
    const bad = await app.inject({ method: 'POST', url: '/api/reports', headers: auth(stranger.token), payload: { targetUserId: peer.id, reason: 'x', evidenceRecordingId: recording.id } })
    expect(bad.statusCode).toBe(400)
    expect(bad.json().error).toBe('invalid_evidence')
    await app.close()
  })

  it('去重时把新证据补挂到既有未结举报上', async () => {
    const { app, owner, peer, recording } = await makeRecording()
    // 先举报（无证据），再举报（带证据）→ 去重但证据补挂。
    await app.inject({ method: 'POST', url: '/api/reports', headers: auth(owner.token), payload: { targetUserId: peer.id, reason: 'first' } })
    const second = await app.inject({ method: 'POST', url: '/api/reports', headers: auth(owner.token), payload: { targetUserId: peer.id, reason: 'second', evidenceRecordingId: recording.id } })
    expect(second.json().deduped).toBe(true)
    expect(second.json().report.evidenceRecordingId).toBe(recording.id)
    await app.close()
  })
})

describe('取证留存：被未结举报引用的录制不被留存清理误删', () => {
  it('过期但被 open 举报引用 → 不删；举报处置后 → 清理', async () => {
    const store = new MemoryStore()
    store.createUser(admin())
    store.setRecordingConfig({ retentionDays: 7 })
    const now = 10_000 * 86_400_000
    store.createMedia({ id: 'evm', ownerId: 'o', mime: 'video/quicktime', size: 1, createdAt: now })
    store.createRecording({ id: 'evrec', callId: 'c', ownerId: 'o', consentBy: [], reason: '', recordedAt: now - 30 * 86_400_000, mediaId: 'evm' })
    store.createReport({ id: 'rep1', reporterId: 'o', targetUserId: 't', reason: 'x', status: 'open', createdAt: now, evidenceRecordingId: 'evrec' })
    expect(sweepExpiredRecordings(store, now)).toBe(0)       // 被未结举报留存
    expect(store.findRecording('evrec')).toBeTruthy()
    store.updateReport('rep1', { status: 'resolved' })
    expect(sweepExpiredRecordings(store, now)).toBe(1)       // 处置后可清
    expect(store.findRecording('evrec')).toBeUndefined()
    expect(store.findMedia('evm')).toBeUndefined()
  })
})

describe('复审修复回归', () => {
  it('HIGH-1：录制媒体不可经通用 /api/media/:id 外泄（owner 的好友也拿不到）', async () => {
    const { app, store, owner, recording } = await makeRecording()
    // friend 与 owner 互为好友，但**不是**通话参与者。
    const friend = await reg(app, 'friend1')
    store.createLink({ id: randomUUID(), ownerId: owner.id, memberId: friend.id, relation: 'friend', isEmergency: false, status: 'accepted', createdAt: Date.now() })
    const mediaId = recording.mediaId as string
    // 录制作用域端点：friend 非 owner/admin → 403。
    const scoped = await app.inject({ method: 'GET', url: `/api/recordings/${recording.id}/media`, headers: auth(friend.token) })
    expect(scoped.statusCode).toBe(403)
    // 通用媒体端点：录制媒体被一律拒绝（404），即便 friend 与 owner 是好友（修复前会 200 泄漏）。
    const generic = await app.inject({ method: 'GET', url: `/api/media/${mediaId}`, headers: auth(friend.token) })
    expect(generic.statusCode).toBe(404)
    // owner 自己经通用端点也拿不到（录制只能走录制端点）。
    const ownerGeneric = await app.inject({ method: 'GET', url: `/api/media/${mediaId}`, headers: auth(owner.token) })
    expect(ownerGeneric.statusCode).toBe(404)
    await app.close()
  })

  it('MED-2：递增 tokenVersion（改密/强制下线）后旧 play-token 立即失效', async () => {
    const { app, store, owner, recording } = await makeRecording()
    const tk = (await app.inject({ method: 'GET', url: `/api/recordings/${recording.id}/play-token`, headers: auth(owner.token) })).json().token
    // 令牌即时可用。
    expect((await app.inject({ method: 'GET', url: `/api/recordings/${recording.id}/media?t=${encodeURIComponent(tk)}` })).statusCode).toBe(200)
    // 强制下线：递增 tokenVersion（status 仍 active）。
    store.updateUser(owner.id, { tokenVersion: (store.findById(owner.id)!.tokenVersion ?? 0) + 1 })
    const after = await app.inject({ method: 'GET', url: `/api/recordings/${recording.id}/media?t=${encodeURIComponent(tk)}` })
    expect(after.statusCode).toBe(401)
    await app.close()
  })

  it('MED-3：第二条不同证据不被去重吞掉——单独建一条带该证据的举报（不丢、受留存保护）', async () => {
    const { app, store, owner, peer, recording } = await makeRecording()
    // owner 名下第二条录制 R2。
    store.createRecording({ id: 'R2', callId: 'c2', ownerId: owner.id, consentBy: [peer.id], reason: '', recordedAt: Date.now(), participants: [owner.id, peer.id] })
    const r1 = await app.inject({ method: 'POST', url: '/api/reports', headers: auth(owner.token), payload: { targetUserId: peer.id, reason: 'one', evidenceRecordingId: recording.id } })
    expect(r1.statusCode).toBe(201)
    const r2 = await app.inject({ method: 'POST', url: '/api/reports', headers: auth(owner.token), payload: { targetUserId: peer.id, reason: 'two', evidenceRecordingId: 'R2' } })
    expect(r2.statusCode).toBe(201)              // 新建，而非 deduped
    expect(r2.json().deduped).toBeUndefined()
    expect(r2.json().report.evidenceRecordingId).toBe('R2')
    // 两条证据都被引用 → 都受留存保护。
    expect(store.reportsCitingRecording(recording.id).length).toBe(1)
    expect(store.reportsCitingRecording('R2').length).toBe(1)
    await app.close()
  })

  it('MED-5：非拥有者（被录方）不能把他人录制作为证据（仅 owner 可）', async () => {
    const { app, peer, recording } = await makeRecording()
    // peer 是参与者/被录方但非 owner → 附 owner 的录制应被拒。
    const bad = await app.inject({ method: 'POST', url: '/api/reports', headers: auth(peer.token), payload: { targetUserId: 'someone', reason: 'x', evidenceRecordingId: recording.id } })
    expect(bad.statusCode).toBe(400)
    expect(bad.json().error).toBe('invalid_evidence')
    await app.close()
  })

  it('LOW-4：被未结举报引用的录制，管理员手动删除被拒（evidence_held）；处置后可删', async () => {
    const { app, at, owner, peer, recording } = await makeRecording()
    await app.inject({ method: 'POST', url: '/api/reports', headers: auth(owner.token), payload: { targetUserId: peer.id, reason: 'abuse', evidenceRecordingId: recording.id } })
    const held = await app.inject({ method: 'DELETE', url: `/api/recordings/${recording.id}`, headers: auth(at) })
    expect(held.statusCode).toBe(409)
    expect(held.json().error).toBe('evidence_held')
    // 找到并处置该举报后可删。
    const rid = (await app.inject({ method: 'GET', url: '/api/admin/reports', headers: auth(at) })).json().reports.find((r: any) => r.evidenceRecordingId === recording.id).id
    await app.inject({ method: 'POST', url: `/api/admin/reports/${rid}/resolve`, headers: auth(at) })
    const del = await app.inject({ method: 'DELETE', url: `/api/recordings/${recording.id}`, headers: auth(at) })
    expect(del.statusCode).toBe(204)
    await app.close()
  })
})

describe('举报处置通知双方', () => {
  it('resolve → 举报人与被举报人各收到一条站内通知', async () => {
    const { app, owner, peer, recording } = await makeRecording()
    const at = await adminToken(app)
    const rep = await app.inject({ method: 'POST', url: '/api/reports', headers: auth(owner.token), payload: { targetUserId: peer.id, reason: 'abuse', evidenceRecordingId: recording.id } })
    const rid = rep.json().report.id
    await app.inject({ method: 'POST', url: `/api/admin/reports/${rid}/resolve`, headers: auth(at) })
    const ownerNotifs = await app.inject({ method: 'GET', url: '/api/notifications', headers: auth(owner.token) })
    const peerNotifs = await app.inject({ method: 'GET', url: '/api/notifications', headers: auth(peer.token) })
    expect(ownerNotifs.json().notifications.some((n: any) => n.kind === 'report_resolved')).toBe(true)
    expect(peerNotifs.json().notifications.some((n: any) => n.kind === 'report_resolved')).toBe(true)
    expect(ownerNotifs.json().unread).toBeGreaterThanOrEqual(1)
    await app.close()
  })

  it('moderate(warn) → 双方收到通知；被举报人通知含 decision；标记已读后 unread 归零', async () => {
    const { app, owner, peer } = await makeRecording()
    const at = await adminToken(app)
    const rep = await app.inject({ method: 'POST', url: '/api/reports', headers: auth(owner.token), payload: { targetUserId: peer.id, reason: 'abuse' } })
    const rid = rep.json().report.id
    await app.inject({ method: 'POST', url: `/api/admin/reports/${rid}/moderate`, headers: auth(at), payload: { action: 'warn', reason: 'be nice' } })
    const peerNotifs = await app.inject({ method: 'GET', url: '/api/notifications', headers: auth(peer.token) })
    const n = peerNotifs.json().notifications.find((x: any) => x.kind === 'report_resolved')
    expect(n).toBeTruthy()
    expect(n.data.decision).toBe('warned') // 被举报人可知关于自己的处置
    // HIGH-6：举报人的通知**不得**含 decision（不泄漏对对方的具体处罚）。
    const ownerNotifs = await app.inject({ method: 'GET', url: '/api/notifications', headers: auth(owner.token) })
    const on = ownerNotifs.json().notifications.find((x: any) => x.kind === 'report_resolved')
    expect(on).toBeTruthy()
    expect(on.data.decision).toBeUndefined()
    // 标记全部已读 → unread 归零。
    await app.inject({ method: 'POST', url: '/api/notifications/read-all', headers: auth(peer.token) })
    const after = await app.inject({ method: 'GET', url: '/api/notifications', headers: auth(peer.token) })
    expect(after.json().unread).toBe(0)
    await app.close()
  })

  it('重复 resolve 不重复通知（仅 open→resolved 一次）', async () => {
    const { app, owner, peer } = await makeRecording()
    const at = await adminToken(app)
    const rep = await app.inject({ method: 'POST', url: '/api/reports', headers: auth(owner.token), payload: { targetUserId: peer.id, reason: 'abuse' } })
    const rid = rep.json().report.id
    await app.inject({ method: 'POST', url: `/api/admin/reports/${rid}/resolve`, headers: auth(at) })
    await app.inject({ method: 'POST', url: `/api/admin/reports/${rid}/resolve`, headers: auth(at) })
    const ownerNotifs = await app.inject({ method: 'GET', url: '/api/notifications', headers: auth(owner.token) })
    expect(ownerNotifs.json().notifications.filter((n: any) => n.kind === 'report_resolved').length).toBe(1)
    await app.close()
  })
})
