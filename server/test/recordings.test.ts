import { describe, it, expect } from 'vitest'
import { buildApp } from '../src/app'
import { MemoryStore, type User, type Recording } from '../src/db/store'
import { hashPassword } from '../src/auth/passwords'
import { expiredRecordingIds } from '../src/recording/retention'

function admin(): User {
  return { id: 'admin1', username: 'root', passwordHash: hashPassword('rootpass1'), displayName: 'root', role: 'admin', status: 'active', createdAt: Date.now() }
}

async function adminToken(app: ReturnType<typeof buildApp>) {
  const r = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'root', password: 'rootpass1' } })
  return r.json().token as string
}

describe('recording retention util', () => {
  it('flags recordings older than retention window', () => {
    const now = 10_000 * 86_400_000
    const recs: Recording[] = [
      { id: 'old', callId: 'c', ownerId: 'o', consentBy: [], reason: '', recordedAt: now - 8 * 86_400_000 },
      { id: 'fresh', callId: 'c', ownerId: 'o', consentBy: [], reason: '', recordedAt: now - 1 * 86_400_000 },
    ]
    expect(expiredRecordingIds(recs, 7, now)).toEqual(['old'])
  })
})

describe('recordings API', () => {
  it('defaults to disabled; POST blocked until enabled + consent', async () => {
    const store = new MemoryStore()
    store.createUser(admin())
    const app = buildApp(store)
    const reg = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'user1', password: 'secret123' } })
    const userToken = reg.json().token
    const userId = reg.json().user.id
    const userAuth = { authorization: `Bearer ${userToken}` }

    const blocked = await app.inject({ method: 'POST', url: '/api/recordings', headers: userAuth, payload: { callId: 'c1', consentBy: [userId] } })
    expect(blocked.statusCode).toBe(403) // recording_disabled

    const at = await adminToken(app)
    const adminAuth = { authorization: `Bearer ${at}` }
    const cfg = await app.inject({ method: 'GET', url: '/api/recordings/config', headers: adminAuth })
    expect(cfg.json().enabled).toBe(false)

    await app.inject({ method: 'PUT', url: '/api/recordings/config', headers: adminAuth, payload: { enabled: true } })

    const noConsent = await app.inject({ method: 'POST', url: '/api/recordings', headers: userAuth, payload: { callId: 'c1' } })
    expect(noConsent.statusCode).toBe(400) // consent_required（无服务端同意记录）

    // 自我同意无效：发起者自己给 callId 授予同意，consenters 排除发起者 → 仍无有效同意。
    await app.inject({ method: 'POST', url: '/api/recordings/consent', headers: userAuth, payload: { callId: 'c1', granted: true } })
    const selfOnly = await app.inject({ method: 'POST', url: '/api/recordings', headers: userAuth, payload: { callId: 'c1' } })
    expect(selfOnly.statusCode).toBe(400)

    // 被录方(非发起者)经鉴权端点授予同意 → 通过；consentBy 由服务端权威填充为该同意者。
    const peer = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'peer1', password: 'secret123' } })
    const peerId = peer.json().user.id
    await app.inject({ method: 'POST', url: '/api/recordings/consent', headers: { authorization: `Bearer ${peer.json().token}` }, payload: { callId: 'c1', granted: true } })
    const ok = await app.inject({ method: 'POST', url: '/api/recordings', headers: userAuth, payload: { callId: 'c1' } })
    expect(ok.statusCode).toBe(201)
    expect(ok.json().recording.consentBy).toEqual([peerId]) // 服务端权威，非客户端自报
    await app.close()
  })

  it('GET purges expired recordings per retention', async () => {
    const store = new MemoryStore()
    store.createUser(admin())
    store.setRecordingConfig({ retentionDays: 7 })
    store.createRecording({ id: 'old', callId: 'c', ownerId: 'o', consentBy: [], reason: '', recordedAt: Date.now() - 30 * 86_400_000 })
    const app = buildApp(store)
    const adminAuth = { authorization: `Bearer ${await adminToken(app)}` }
    const list = await app.inject({ method: 'GET', url: '/api/recordings', headers: adminAuth })
    expect(list.json().purged).toBe(1)
    expect(list.json().recordings.length).toBe(0)
    await app.close()
  })
})

import { sweepExpiredRecordings } from '../src/recording/retention'
import type { MediaMeta } from '../src/db/store'

describe('recordings media-link + 级联 + 后台清理（录制功能补完）', () => {
  async function enableRecording(app: ReturnType<typeof buildApp>, at: string, requireConsent = true) {
    await app.inject({ method: 'PUT', url: '/api/recordings/config', headers: { authorization: `Bearer ${at}` }, payload: { enabled: true, requireConsent, retentionDays: 7 } })
  }
  function setup() {
    const store = new MemoryStore()
    store.createUser(admin())
    const app = buildApp(store)
    return { store, app }
  }

  it('POST 带本人 mediaId → 记到录制；带他人 mediaId → 400 invalid_media', async () => {
    const { store, app } = setup()
    const at = await adminToken(app)
    await enableRecording(app, at)
    const reg = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'rec1', password: 'secret123' } })
    const uid = reg.json().user.id, utok = reg.json().token
    const reg2 = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'peer1', password: 'secret123' } })
    const peerId = reg2.json().user.id, ptok = reg2.json().token
    // 被录方授予同意（服务端权威）。
    await app.inject({ method: 'POST', url: '/api/recordings/consent', headers: { authorization: `Bearer ${ptok}` }, payload: { callId: 'c1', granted: true } })

    const mine: MediaMeta = { id: 'media-mine', ownerId: uid, mime: 'video/quicktime', size: 100, createdAt: Date.now() }
    store.createMedia(mine)
    const ok = await app.inject({ method: 'POST', url: '/api/recordings', headers: { authorization: `Bearer ${utok}` }, payload: { callId: 'c1', mediaId: 'media-mine', reason: 'evidence' } })
    expect(ok.statusCode).toBe(201)
    expect(ok.json().recording.mediaId).toBe('media-mine')
    expect(ok.json().recording.consentBy).toEqual([peerId])

    const theirs: MediaMeta = { id: 'media-theirs', ownerId: peerId, mime: 'video/quicktime', size: 100, createdAt: Date.now() }
    store.createMedia(theirs)
    const bad = await app.inject({ method: 'POST', url: '/api/recordings', headers: { authorization: `Bearer ${utok}` }, payload: { callId: 'c1', mediaId: 'media-theirs' } })
    expect(bad.statusCode).toBe(400)
    expect(bad.json().error).toBe('invalid_media')
  })

  it('DELETE 录制 → 级联删媒体元数据', async () => {
    const { store, app } = setup()
    const at = await adminToken(app)
    await enableRecording(app, at)
    const reg = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'rec2', password: 'secret123' } })
    const uid = reg.json().user.id, utok = reg.json().token
    // 对端(admin)授予同意。
    await app.inject({ method: 'POST', url: '/api/recordings/consent', headers: { authorization: `Bearer ${at}` }, payload: { callId: 'c', granted: true } })
    store.createMedia({ id: 'm2', ownerId: uid, mime: 'video/quicktime', size: 1, createdAt: Date.now() })
    const created = await app.inject({ method: 'POST', url: '/api/recordings', headers: { authorization: `Bearer ${utok}` }, payload: { callId: 'c', mediaId: 'm2' } })
    const rid = created.json().recording.id
    const del = await app.inject({ method: 'DELETE', url: `/api/recordings/${rid}`, headers: { authorization: `Bearer ${at}` } })
    expect(del.statusCode).toBe(204)
    expect(store.findMedia('m2')).toBeUndefined() // 媒体元数据被级联删
    expect(store.findRecording(rid)).toBeUndefined()
  })

  it('sweepExpiredRecordings 删过期录制 + 其媒体；GET 列表也触发清理', async () => {
    const store = new MemoryStore()
    store.setRecordingConfig({ retentionDays: 7 })
    const now = 10_000 * 86_400_000
    store.createMedia({ id: 'em', ownerId: 'o', mime: 'video/quicktime', size: 1, createdAt: now })
    store.createRecording({ id: 'oldrec', callId: 'c', ownerId: 'o', consentBy: [], reason: '', recordedAt: now - 8 * 86_400_000, mediaId: 'em' })
    store.createRecording({ id: 'freshrec', callId: 'c', ownerId: 'o', consentBy: [], reason: '', recordedAt: now - 1 * 86_400_000 })
    const purged = sweepExpiredRecordings(store, now)
    expect(purged).toBe(1)
    expect(store.findRecording('oldrec')).toBeUndefined()
    expect(store.findMedia('em')).toBeUndefined() // 过期录制的媒体一并清
    expect(store.findRecording('freshrec')).toBeTruthy()
  })
})

import { RecordingConsentRegistry } from '../src/recording/consentRegistry'

describe('录制知情同意（服务端权威）', () => {
  it('consenters 排除发起者、可撤回、按 TTL 过期', () => {
    const reg = new RecordingConsentRegistry(1000) // 1s TTL
    const now = 1_000_000
    reg.grant('call1', 'peer', now)
    reg.grant('call1', 'owner', now) // 发起者自我同意无效
    expect(reg.consenters('call1', 'owner', now)).toEqual(['peer'])
    reg.revoke('call1', 'peer')
    expect(reg.consenters('call1', 'owner', now)).toEqual([])
    reg.grant('call2', 'peer', now)
    expect(reg.consenters('call2', 'owner', now + 2000)).toEqual([]) // 已过期
  })

  it('端点：被改造客户端即使自报 consentBy 也无效——以服务端同意记录为准', async () => {
    const store = new MemoryStore()
    store.createUser(admin())
    store.setRecordingConfig({ enabled: true, requireConsent: true })
    const app = buildApp(store)
    const reg = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'attacker', password: 'secret123' } })
    const utok = reg.json().token
    // 自报一个伪造的 consentBy（旧字段已被服务端忽略）→ 无真实同意 → 仍 400。
    const spoof = await app.inject({ method: 'POST', url: '/api/recordings', headers: { authorization: `Bearer ${utok}` }, payload: { callId: 'cx', consentBy: ['victim-id'] } })
    expect(spoof.statusCode).toBe(400)
    expect(spoof.json().error).toBe('consent_required')
    await app.close()
  })
})
