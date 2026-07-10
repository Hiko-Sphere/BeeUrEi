import { describe, it, expect, beforeAll } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// 证件密文写入隔离临时目录（不污染工作区 data/kyc）。必须在 import crypto/storage 前设置 env。
process.env.KYC_DIR = mkdtempSync(join(tmpdir(), 'kyc-test-'))

import { buildApp } from '../src/app'
import { MemoryStore, type Store, type User, publicUser, selfView } from '../src/db/store'
import { SqliteStore } from '../src/db/sqliteStore'
import { hashPassword } from '../src/auth/passwords'
import { kycBlobExists } from '../src/kyc/storage'
import { sweepStaleVerifications, STALE_PENDING_DAYS, VERIFIED_GRACE_DAYS } from '../src/kyc/retention'
import { cascadeDeleteUser } from '../src/db/cascade'

const auth = (t: string) => ({ authorization: `Bearer ${t}` })

// 最小但结构合法的 JPEG：SOI + DQT + SOS + 扫描数据 + EOI。normalizeImage 接受。
function makeJpeg(): Buffer {
  const soi = Buffer.from([0xff, 0xd8])
  const dqtData = Buffer.alloc(65, 0x10)
  const dqt = Buffer.concat([Buffer.from([0xff, 0xdb]), Buffer.from([0x00, dqtData.length + 2]), dqtData])
  const sos = Buffer.from([0xff, 0xda, 0x00, 0x03, 0x01])
  const scan = Buffer.from([0x9a, 0xbc, 0xde])
  const eoi = Buffer.from([0xff, 0xd9])
  return Buffer.concat([soi, dqt, sos, scan, eoi])
}

function seedAdminStore(make: () => Store): Store {
  const store = make()
  const admin: User = { id: 'admin1', username: 'root', passwordHash: hashPassword('rootpass1'), displayName: 'root', role: 'admin', status: 'active', createdAt: Date.now() }
  store.createUser(admin)
  return store
}

async function login(app: ReturnType<typeof buildApp>, username: string, password: string) {
  const r = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password } })
  return r.json().token as string
}
async function reg(app: ReturnType<typeof buildApp>, username: string) {
  const r = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username, password: 'secret123' } })
  return r.json() as { token: string; user: { id: string } }
}

// 提交实名 + 上传正面 + 自拍，返回 verification id。
async function submitKyc(app: ReturnType<typeof buildApp>, token: string, name = '张三 Zhang San') {
  const sub = await app.inject({
    method: 'POST', url: '/api/account/verification', headers: auth(token),
    payload: { legalName: name, idType: 'national_id', idNumberLast4: '6789', idNumber: '11010119900307XXXX', consentVersion: 'kyc-1' },
  })
  expect(sub.statusCode).toBe(201)
  const { id } = sub.json() as { id: string }
  for (const kind of ['front', 'selfie']) {
    const up = await app.inject({ method: 'POST', url: `/api/account/verification/${id}/doc/${kind}`, headers: { ...auth(token), 'content-type': 'image/jpeg' }, payload: makeJpeg() })
    expect(up.statusCode).toBe(200)
  }
  return id
}

const stores: Array<[string, () => Store]> = [
  ['MemoryStore', () => new MemoryStore()],
  ['SqliteStore', () => new SqliteStore(':memory:')],
]

describe.each(stores)('KYC end-to-end (%s)', (_name, make) => {
  it('submit → pending; admin approve → verified badge + docs purged; name kept', async () => {
    const store = seedAdminStore(make)
    const app = buildApp(store)
    const { token } = await reg(app, 'alice')
    const adminToken = await login(app, 'root', 'rootpass1')

    const id = await submitKyc(app, token)

    // 用户状态 pending；徽章仍为 false
    const st = await app.inject({ method: 'GET', url: '/api/account/verification', headers: auth(token) })
    expect(st.json().status).toBe('pending')
    const me1 = await app.inject({ method: 'GET', url: '/api/me', headers: auth(token) })
    expect(me1.json().user.verified).toBe(false)

    // 审核前：记录有 nameSealed + 两张 blob
    const before = store.findVerification(id)!
    expect(before.nameSealed).toBeTruthy()
    expect(before.blobs?.length).toBe(2)
    const blobIds = before.blobs!.map((b) => b.blobId)
    expect(blobIds.every((b) => kycBlobExists(b))).toBe(true)

    // admin 通过
    const ap = await app.inject({ method: 'POST', url: `/api/admin/verifications/${id}/approve`, headers: auth(adminToken) })
    expect(ap.statusCode).toBe(200)

    // 徽章 true；记录 verified；blob 文件已删；nameSealed 保留（徽章法律依据）；idNumber 已清
    const me2 = await app.inject({ method: 'GET', url: '/api/me', headers: auth(token) })
    expect(me2.json().user.verified).toBe(true)
    const after = store.findVerification(id)!
    expect(after.status).toBe('verified')
    expect(after.nameSealed).toBeTruthy()
    expect(after.idNumberSealed).toBeUndefined()
    expect(after.blobs == null || after.blobs.length === 0).toBe(true)
    expect(blobIds.some((b) => kycBlobExists(b))).toBe(false)

    // 通过后再取证件图 → 404
    const doc = await app.inject({ method: 'GET', url: `/api/admin/verifications/${id}/doc/front`, headers: auth(adminToken) })
    expect(doc.statusCode).toBe(404)

    // 用户收到 kyc_verified 通知
    const notifs = store.notificationsForUser(store.findByUsername('alice')!.id)
    expect(notifs.some((n) => n.kind === 'kyc_verified')).toBe(true)
    await app.close()
  })

  it('admin reject with reason → rejected + name/docs purged + reason notified; user can resubmit', async () => {
    const store = seedAdminStore(make)
    const app = buildApp(store)
    const { token } = await reg(app, 'bob')
    const adminToken = await login(app, 'root', 'rootpass1')
    const id = await submitKyc(app, token)

    const blobIds = store.findVerification(id)!.blobs!.map((b) => b.blobId)
    const rj = await app.inject({ method: 'POST', url: `/api/admin/verifications/${id}/reject`, headers: auth(adminToken), payload: { reasonCode: 'blurry', note: '边缘模糊' } })
    expect(rj.statusCode).toBe(200)

    const v = store.findVerification(id)!
    expect(v.status).toBe('rejected')
    expect(v.rejectReasonCode).toBe('blurry')
    expect(v.nameSealed).toBeUndefined()
    expect(v.idNumberSealed).toBeUndefined()
    expect(blobIds.some((b) => kycBlobExists(b))).toBe(false)

    const userId = store.findByUsername('bob')!.id
    expect(store.findById(userId)!.identityVerified).toBeFalsy()
    const notifs = store.notificationsForUser(userId)
    const rejected = notifs.find((n) => n.kind === 'kyc_rejected')
    expect(rejected?.data?.reasonCode).toBe('blurry')

    // 状态可见拒绝原因 + 可重新提交
    const st = await app.inject({ method: 'GET', url: '/api/account/verification', headers: auth(token) })
    expect(st.json().status).toBe('rejected')
    expect(st.json().rejectReasonCode).toBe('blurry')
    expect(st.json().canResubmit).toBe(true)

    // 重新提交 → 新 pending（attempt 2）
    const sub2 = await app.inject({ method: 'POST', url: '/api/account/verification', headers: auth(token), payload: { legalName: '李四', idType: 'passport', idNumberLast4: '1234', consentVersion: 'kyc-1' } })
    expect(sub2.statusCode).toBe(201)
    expect(sub2.json().attempt).toBe(2)
    await app.close()
  })

  it('double-submit while pending → 409; while verified → 409', async () => {
    const store = seedAdminStore(make)
    const app = buildApp(store)
    const { token } = await reg(app, 'carol')
    const adminToken = await login(app, 'root', 'rootpass1')
    const id = await submitKyc(app, token)

    const dup = await app.inject({ method: 'POST', url: '/api/account/verification', headers: auth(token), payload: { legalName: 'x', idType: 'national_id', idNumberLast4: '0000', consentVersion: 'kyc-1' } })
    expect(dup.statusCode).toBe(409)
    expect(dup.json().error).toBe('already_pending')

    await app.inject({ method: 'POST', url: `/api/admin/verifications/${id}/approve`, headers: auth(adminToken) })
    const dup2 = await app.inject({ method: 'POST', url: '/api/account/verification', headers: auth(token), payload: { legalName: 'x', idType: 'national_id', idNumberLast4: '0000', consentVersion: 'kyc-1' } })
    expect(dup2.statusCode).toBe(409)
    expect(dup2.json().error).toBe('already_verified')
    await app.close()
  })

  it('并发双提交（两次都过了活跃检查）→ 只留一条 active（两存储同口径：SqliteStore uniq_verif_active / MemoryStore 补齐）', () => {
    // 端点的活跃检查(getActiveVerificationForUser)与 createVerification 在真并发下都可能先各自看到"无活跃"再各自写入。
    // prod 的 SqliteStore 靠 uniq_verif_active(INSERT OR REPLACE) 兜底只留后者；MemoryStore 此前会存两条（parity 缺口）。
    const store = make()
    const now = Date.now()
    store.createVerification({ id: 'vA', userId: 'racer', status: 'pending', idType: 'national_id', submittedVia: 'self', submittedById: 'racer', submittedAt: now, attempt: 1 })
    store.createVerification({ id: 'vB', userId: 'racer', status: 'pending', idType: 'national_id', submittedVia: 'self', submittedById: 'racer', submittedAt: now + 1, attempt: 2 })
    const active = store.listVerifications('pending').filter((x) => x.userId === 'racer')
    expect(active).toHaveLength(1)                                  // 恰一条 active（非两条）——"一人一活跃"不变量
    expect(active[0].id).toBe('vB')                                 // 后者取代前者（REPLACE 语义）
    expect(store.getActiveVerificationForUser('racer')?.id).toBe('vB')
    expect(store.findVerification('vA')).toBeUndefined()            // 前者已被替换删除
  })
})

describe('KYC security invariants (MemoryStore)', () => {
  it('non-admin cannot reach decrypt/view/decision endpoints (403)', async () => {
    const store = seedAdminStore(() => new MemoryStore())
    const app = buildApp(store)
    const { token } = await reg(app, 'alice')
    const adminToken = await login(app, 'root', 'rootpass1')
    const id = await submitKyc(app, token)

    for (const url of [
      `/api/admin/verifications`,
      `/api/admin/verifications/${id}`,
      `/api/admin/verifications/${id}/doc/front`,
    ]) {
      const r = await app.inject({ method: 'GET', url, headers: auth(token) })
      expect(r.statusCode).toBe(403)
    }
    const r2 = await app.inject({ method: 'POST', url: `/api/admin/verifications/${id}/approve`, headers: auth(token) })
    expect(r2.statusCode).toBe(403)
    // admin 可以
    const ok = await app.inject({ method: 'GET', url: `/api/admin/verifications/${id}`, headers: auth(adminToken) })
    expect(ok.statusCode).toBe(200)
    await app.close()
  })

  it('legal name / sealed fields never appear in publicUser or selfView', async () => {
    const store = seedAdminStore(() => new MemoryStore())
    const app = buildApp(store)
    const { token } = await reg(app, 'alice')
    const adminToken = await login(app, 'root', 'rootpass1')
    const id = await submitKyc(app, token, 'Top Secret Name')
    await app.inject({ method: 'POST', url: `/api/admin/verifications/${id}/approve`, headers: auth(adminToken) })

    const u = store.findByUsername('alice')!
    const pub = publicUser(u) as Record<string, unknown>
    const self = selfView(u) as Record<string, unknown>
    for (const k of ['nameSealed', 'idNumberSealed', 'blobs', 'legalName', 'idNumber']) {
      expect(k in pub).toBe(false)
      expect(k in self).toBe(false)
    }
    expect(pub.verified).toBe(true)
    expect(JSON.stringify(pub)).not.toContain('Top Secret Name')
    expect(JSON.stringify(self)).not.toContain('Top Secret Name')

    // /api/admin/users（用 publicUser）不含姓名
    const list = await app.inject({ method: 'GET', url: '/api/admin/users', headers: auth(adminToken) })
    expect(list.payload).not.toContain('Top Secret Name')
    await app.close()
  })

  it('admin detail decrypts name + idNumber and audits kyc.view / kyc.view-doc', async () => {
    const store = seedAdminStore(() => new MemoryStore())
    const app = buildApp(store)
    const { token } = await reg(app, 'alice')
    const adminToken = await login(app, 'root', 'rootpass1')
    const id = await submitKyc(app, token, '王五 Wang Wu')

    const detail = await app.inject({ method: 'GET', url: `/api/admin/verifications/${id}`, headers: auth(adminToken) })
    expect(detail.json().legalName).toBe('王五 Wang Wu')
    expect(detail.json().idNumber).toBe('11010119900307XXXX')

    const doc = await app.inject({ method: 'GET', url: `/api/admin/verifications/${id}/doc/front`, headers: auth(adminToken) })
    expect(doc.statusCode).toBe(200)
    expect(doc.headers['content-type']).toBe('image/jpeg')
    expect(doc.headers['cache-control']).toContain('no-store')

    const audits = store.allAuditEntries(50)
    const actions = audits.map((a) => a.action)
    expect(actions).toContain('kyc.view')
    expect(actions).toContain('kyc.view-doc')
    await app.close()
  })

  it('an admin cannot review their own submission (403)', async () => {
    const store = seedAdminStore(() => new MemoryStore())
    const app = buildApp(store)
    const adminToken = await login(app, 'root', 'rootpass1')
    // admin 自己提交
    const id = await submitKyc(app, adminToken, 'Self Admin')
    // 决策端点
    const ap = await app.inject({ method: 'POST', url: `/api/admin/verifications/${id}/approve`, headers: auth(adminToken) })
    expect(ap.statusCode).toBe(403)
    const rj = await app.inject({ method: 'POST', url: `/api/admin/verifications/${id}/reject`, headers: auth(adminToken), payload: { reasonCode: 'other' } })
    expect(rj.statusCode).toBe(403)
    // 解密查看端点（详情/证件图）与 hold 也禁止自审
    const detail = await app.inject({ method: 'GET', url: `/api/admin/verifications/${id}`, headers: auth(adminToken) })
    expect(detail.statusCode).toBe(403)
    const doc = await app.inject({ method: 'GET', url: `/api/admin/verifications/${id}/doc/front`, headers: auth(adminToken) })
    expect(doc.statusCode).toBe(403)
    const hold = await app.inject({ method: 'POST', url: `/api/admin/verifications/${id}/hold`, headers: auth(adminToken) })
    expect(hold.statusCode).toBe(403)
    await app.close()
  })

  it('rejects non-image / missing consent / oversized / corrupt', async () => {
    const store = seedAdminStore(() => new MemoryStore())
    const app = buildApp(store)
    const { token } = await reg(app, 'alice')
    // 缺 consentVersion → 400
    const noConsent = await app.inject({ method: 'POST', url: '/api/account/verification', headers: auth(token), payload: { legalName: 'a', idType: 'national_id', idNumberLast4: '1234' } })
    expect(noConsent.statusCode).toBe(400)

    const sub = await app.inject({ method: 'POST', url: '/api/account/verification', headers: auth(token), payload: { legalName: 'a', idType: 'national_id', idNumberLast4: '1234', consentVersion: 'kyc-1' } })
    const id = sub.json().id
    // 非图片字节 → 415
    const bad = await app.inject({ method: 'POST', url: `/api/account/verification/${id}/doc/front`, headers: { ...auth(token), 'content-type': 'image/jpeg' }, payload: Buffer.from('not an image') })
    expect(bad.statusCode).toBe(415)
    // 非法 kind → 400
    const badKind = await app.inject({ method: 'POST', url: `/api/account/verification/${id}/doc/back2`, headers: { ...auth(token), 'content-type': 'image/jpeg' }, payload: makeJpeg() })
    expect(badKind.statusCode).toBe(400)
    await app.close()
  })

  it('decideVerification is exactly-once under race (second call no-ops)', () => {
    const store = new MemoryStore()
    store.createVerification({ id: 'v1', userId: 'u1', status: 'pending', idType: 'national_id', submittedVia: 'self', submittedById: 'u1', submittedAt: Date.now(), attempt: 1 })
    const first = store.decideVerification('v1', { status: 'verified', decidedAt: Date.now(), decidedBy: 'admin1' })
    const second = store.decideVerification('v1', { status: 'rejected', decidedAt: Date.now(), decidedBy: 'admin2' })
    expect(first?.status).toBe('verified')
    expect(second).toBeUndefined()
    expect(store.findVerification('v1')!.status).toBe('verified')
  })

  it('admin can revoke a verified badge', async () => {
    const store = seedAdminStore(() => new MemoryStore())
    const app = buildApp(store)
    const { token } = await reg(app, 'alice')
    const adminToken = await login(app, 'root', 'rootpass1')
    const id = await submitKyc(app, token)
    await app.inject({ method: 'POST', url: `/api/admin/verifications/${id}/approve`, headers: auth(adminToken) })
    expect(store.findByUsername('alice')!.identityVerified).toBe(true)

    const rev = await app.inject({ method: 'POST', url: `/api/admin/verifications/${id}/revoke`, headers: auth(adminToken) })
    expect(rev.statusCode).toBe(200)
    expect(store.findByUsername('alice')!.identityVerified).toBe(false)
    expect(store.findVerification(id)!.status).toBe('rejected')
    expect(store.findVerification(id)!.rejectReasonCode).toBe('revoked')
    await app.close()
  })
})

describe('KYC retention + cascade (MemoryStore)', () => {
  function pendingV(id: string, userId: string, submittedAt: number, blobId = `${id}-b`) {
    const store = new MemoryStore()
    store.createVerification({ id, userId, status: 'pending', idType: 'national_id', nameSealed: { keyId: 'k1', wrappedDek: 'x', iv: 'y', tag: 'z', ct: 'c' }, blobs: [{ kind: 'front', blobId, sealed: { keyId: 'k1', wrappedDek: 'x', iv: 'y', tag: 'z' }, mime: 'image/jpeg' }], submittedVia: 'self', submittedById: userId, submittedAt, attempt: 1 })
    return store
  }

  it('stale pending > 30d is auto-rejected (timeout) and purged', () => {
    const now = Date.now()
    const store = pendingV('v1', 'u1', now - (STALE_PENDING_DAYS + 1) * 86_400_000)
    const n = sweepStaleVerifications(store, now)
    expect(n).toBe(1)
    const v = store.findVerification('v1')!
    expect(v.status).toBe('rejected')
    expect(v.rejectReasonCode).toBe('timeout')
    expect(v.nameSealed).toBeUndefined()
    expect(v.blobs).toBeUndefined()
  })

  it('verified past 7d grace purges docs but keeps name + badge', () => {
    const now = Date.now()
    const store = new MemoryStore()
    store.createVerification({ id: 'v2', userId: 'u2', status: 'verified', idType: 'national_id', nameSealed: { keyId: 'k1', wrappedDek: 'x', iv: 'y', tag: 'z', ct: 'c' }, idNumberSealed: { keyId: 'k1', wrappedDek: 'x', iv: 'y', tag: 'z', ct: 'c' }, blobs: [{ kind: 'front', blobId: 'v2-b', sealed: { keyId: 'k1', wrappedDek: 'x', iv: 'y', tag: 'z' }, mime: 'image/jpeg' }], submittedVia: 'self', submittedById: 'u2', submittedAt: now - 30 * 86_400_000, decidedAt: now - (VERIFIED_GRACE_DAYS + 1) * 86_400_000, attempt: 1 })
    const n = sweepStaleVerifications(store, now)
    expect(n).toBe(1)
    const v = store.findVerification('v2')!
    expect(v.status).toBe('verified')
    expect(v.blobs).toBeUndefined()
    expect(v.idNumberSealed).toBeUndefined()
    expect(v.nameSealed).toBeTruthy() // 保留
  })

  it('legal hold exempts from sweep and survives cascade delete; non-held purged on cascade', () => {
    const now = Date.now()
    const store = new MemoryStore()
    store.createUser({ id: 'u3', username: 'dave', passwordHash: 'h', displayName: 'dave', role: 'blind', status: 'active', createdAt: now })
    store.createVerification({ id: 'held', userId: 'u3', status: 'pending', idType: 'national_id', legalHold: true, blobs: [{ kind: 'front', blobId: 'held-b', sealed: { keyId: 'k1', wrappedDek: 'x', iv: 'y', tag: 'z' }, mime: 'image/jpeg' }], submittedVia: 'self', submittedById: 'u3', submittedAt: now - 60 * 86_400_000, attempt: 1 })
    store.createVerification({ id: 'free', userId: 'u3', status: 'rejected', idType: 'national_id', submittedVia: 'self', submittedById: 'u3', submittedAt: now - 60 * 86_400_000, attempt: 2 })
    // sweep 不动 legalHold 的停滞 pending
    expect(sweepStaleVerifications(store, now)).toBe(0)
    expect(store.findVerification('held')!.status).toBe('pending')
    // 级联删号：保留 held，删除非 held
    cascadeDeleteUser(store, 'u3')
    expect(store.findVerification('held')).toBeTruthy()
    expect(store.findVerification('free')).toBeUndefined()
  })
})
