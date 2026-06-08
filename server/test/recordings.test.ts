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

    const noConsent = await app.inject({ method: 'POST', url: '/api/recordings', headers: userAuth, payload: { callId: 'c1', consentBy: [] } })
    expect(noConsent.statusCode).toBe(400) // consent_required

    // 自我同意应被拒绝——同意必须来自被录制的对方参与者，而非发起者本人（见审查 #4）。
    const selfOnly = await app.inject({ method: 'POST', url: '/api/recordings', headers: userAuth, payload: { callId: 'c1', consentBy: [userId] } })
    expect(selfOnly.statusCode).toBe(400)

    // 含被录方(非发起者)的同意 → 通过。
    const ok = await app.inject({ method: 'POST', url: '/api/recordings', headers: userAuth, payload: { callId: 'c1', consentBy: ['peer-blind-user'] } })
    expect(ok.statusCode).toBe(201)
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
