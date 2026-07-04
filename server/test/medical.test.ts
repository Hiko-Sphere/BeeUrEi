import { describe, it, expect } from 'vitest'
import { buildApp } from '../src/app'
import { MemoryStore } from '../src/db/store'
import { SqliteStore } from '../src/db/sqliteStore'
import { cascadeDeleteUser } from '../src/db/cascade'
import { buildSelfExportExtras, buildUserExportBundle } from '../src/account/exportBundle'

const bearer = (t: string) => ({ authorization: `Bearer ${t}` })

async function seed() {
  const store = new MemoryStore()
  const a = buildApp(store)
  const reg = async (u: string, role: string) =>
    (await a.inject({ method: 'POST', url: '/api/auth/register', payload: { username: u, password: 'secret123', role } })).json()
  const owner = await reg('medowner', 'blind')       // 遇险者（填写医疗信息）
  const emerg = await reg('medemerg', 'family')       // 紧急亲友（可读）
  const plain = await reg('medplain', 'family')        // 普通已接受亲友（isEmergency=false，不可读）
  const stranger = await reg('medstranger', 'helper')  // 陌生人（不可读）
  // owner 加两个亲友：emerg 标 isEmergency，plain 不标。
  for (const [u, tok, isEmergency] of [['medemerg', emerg.token, true], ['medplain', plain.token, false]] as const) {
    const l = await a.inject({ method: 'POST', url: '/api/family/links', headers: bearer(owner.token),
      payload: { username: u, relation: '家人', isEmergency } })
    await a.inject({ method: 'POST', url: `/api/family/links/${l.json().link.id}/accept`, headers: bearer(tok) })
  }
  const ownerId = store.findByUsername('medowner')!.id
  return { a, store, owner, emerg, plain, stranger, ownerId }
}

describe('紧急医疗信息 /api/account/medical + /api/family/:id/medical', () => {
  it('本人填写→读回明文一致；落库是密文（不含明文）；空串清除', async () => {
    const { a, store, owner, ownerId } = await seed()
    const secret = '血型 O 型，青霉素过敏，服用华法林'
    const put = await a.inject({ method: 'PUT', url: '/api/account/medical', headers: bearer(owner.token), payload: { text: secret } })
    expect(put.statusCode).toBe(200)
    // 读回明文一致
    const get = await a.inject({ method: 'GET', url: '/api/account/medical', headers: bearer(owner.token) })
    expect(get.json().medicalInfo).toBe(secret)
    expect(get.json().updatedAt).toBeTypeOf('number')
    // 落库是密文：sealed 里绝不含明文子串（AES-256-GCM 加密）
    const rec = store.getMedicalInfo(ownerId)!
    expect(rec.sealed).not.toContain('华法林')
    expect(rec.sealed).not.toContain('青霉素')
    // 空串清除
    await a.inject({ method: 'PUT', url: '/api/account/medical', headers: bearer(owner.token), payload: { text: '  ' } })
    expect(store.getMedicalInfo(ownerId)).toBeUndefined()
    expect((await a.inject({ method: 'GET', url: '/api/account/medical', headers: bearer(owner.token) })).json().medicalInfo).toBe('')
    await a.close()
  })

  it('授权：仅 accepted isEmergency 亲友可读；普通亲友/陌生人 403', async () => {
    const { a, owner, emerg, plain, stranger, ownerId } = await seed()
    await a.inject({ method: 'PUT', url: '/api/account/medical', headers: bearer(owner.token), payload: { text: '糖尿病，随身胰岛素' } })
    // 紧急亲友：可读，带遇险者名
    const ok = await a.inject({ method: 'GET', url: `/api/family/${ownerId}/medical`, headers: bearer(emerg.token) })
    expect(ok.statusCode).toBe(200)
    expect(ok.json().medicalInfo).toBe('糖尿病，随身胰岛素')
    expect(ok.json().fromName).toBe('medowner')
    // 普通已接受亲友（非 isEmergency）：403
    expect((await a.inject({ method: 'GET', url: `/api/family/${ownerId}/medical`, headers: bearer(plain.token) })).statusCode).toBe(403)
    // 陌生人：403
    expect((await a.inject({ method: 'GET', url: `/api/family/${ownerId}/medical`, headers: bearer(stranger.token) })).statusCode).toBe(403)
    await a.close()
  })

  it('访问透明：紧急亲友查看 → 本人收 medical_info_viewed 通知（带查看者名）；10 分钟内去重；本人自看不通知', async () => {
    const { a, store, owner, emerg, ownerId } = await seed()
    await a.inject({ method: 'PUT', url: '/api/account/medical', headers: bearer(owner.token), payload: { text: '哮喘' } })
    const viewedNotifs = () => store.notificationsForUser(ownerId).filter((n) => n.kind === 'medical_info_viewed')
    // 紧急亲友查看 → 本人收到一条透明通知。
    await a.inject({ method: 'GET', url: `/api/family/${ownerId}/medical`, headers: bearer(emerg.token) })
    expect(viewedNotifs()).toHaveLength(1)
    expect(viewedNotifs()[0].title).toContain('medemerg')          // 查看者名
    expect(viewedNotifs()[0].data).toMatchObject({ viewerId: store.findByUsername('medemerg')!.id })
    // 同一查看者短时间内再看 → 去重，不重复通知。
    await a.inject({ method: 'GET', url: `/api/family/${ownerId}/medical`, headers: bearer(emerg.token) })
    expect(viewedNotifs()).toHaveLength(1)
    // 本人查看自己的 → 不产生透明通知（自看无需问责）。
    await a.inject({ method: 'GET', url: `/api/account/medical`, headers: bearer(owner.token) })
    expect(viewedNotifs()).toHaveLength(1)
    await a.close()
  })

  it('未授权/未填的查看不产生访问透明通知', async () => {
    const { a, store, owner, plain, stranger, emerg, ownerId } = await seed()
    const viewedNotifs = () => store.notificationsForUser(ownerId).filter((n) => n.kind === 'medical_info_viewed')
    // 未填时授权亲友查看（404）→ 无通知（没东西可看，不算访问）。
    await a.inject({ method: 'GET', url: `/api/family/${ownerId}/medical`, headers: bearer(emerg.token) })
    expect(viewedNotifs()).toHaveLength(0)
    // 填好后，普通亲友/陌生人（403）查看 → 无通知（未授权、没看到）。
    await a.inject({ method: 'PUT', url: '/api/account/medical', headers: bearer(owner.token), payload: { text: '糖尿病' } })
    await a.inject({ method: 'GET', url: `/api/family/${ownerId}/medical`, headers: bearer(plain.token) })
    await a.inject({ method: 'GET', url: `/api/family/${ownerId}/medical`, headers: bearer(stranger.token) })
    expect(viewedNotifs()).toHaveLength(0)
    await a.close()
  })

  it('对方未填 → 授权亲友得 404（no_medical_info）', async () => {
    const { a, emerg, ownerId } = await seed()
    const r = await a.inject({ method: 'GET', url: `/api/family/${ownerId}/medical`, headers: bearer(emerg.token) })
    expect(r.statusCode).toBe(404)
    expect(r.json()).toMatchObject({ error: 'no_medical_info' })
    await a.close()
  })

  it('导出：自助版含解密后的医疗信息；admin 底座绝不含（健康数据不给管理员看）', async () => {
    const { a, store, owner, ownerId } = await seed()
    await a.inject({ method: 'PUT', url: '/api/account/medical', headers: bearer(owner.token), payload: { text: '心脏起搏器' } })
    const self = buildSelfExportExtras(store, ownerId)
    expect(self.medicalInfo).toMatchObject({ text: '心脏起搏器' })
    const adminBundle = buildUserExportBundle(store, ownerId, Date.now())
    expect(JSON.stringify(adminBundle)).not.toContain('心脏起搏器') // admin 导出绝不含健康数据
    await a.close()
  })

  it('删号级联清除医疗信息', async () => {
    const { a, store, ownerId, owner } = await seed()
    await a.inject({ method: 'PUT', url: '/api/account/medical', headers: bearer(owner.token), payload: { text: '哮喘' } })
    expect(store.getMedicalInfo(ownerId)).toBeTruthy()
    cascadeDeleteUser(store, ownerId)
    expect(store.getMedicalInfo(ownerId)).toBeUndefined()
    await a.close()
  })
})

describe('MedicalInfo 存储 parity（Memory ↔ Sqlite）', () => {
  for (const make of [() => new MemoryStore(), () => new SqliteStore(':memory:')]) {
    const store = make()
    it(`${store.constructor.name}: set/get/delete 一致`, () => {
      expect(store.getMedicalInfo('u1')).toBeUndefined()
      store.setMedicalInfo({ userId: 'u1', sealed: 'ct-blob', updatedAt: 111 })
      expect(store.getMedicalInfo('u1')).toMatchObject({ userId: 'u1', sealed: 'ct-blob', updatedAt: 111 })
      store.setMedicalInfo({ userId: 'u1', sealed: 'ct-blob-2', updatedAt: 222 }) // 覆盖
      expect(store.getMedicalInfo('u1')?.sealed).toBe('ct-blob-2')
      store.setMedicalInfo({ userId: 'u2', sealed: 'other', updatedAt: 1 })
      store.deleteMedicalInfoForUser('u1')
      expect(store.getMedicalInfo('u1')).toBeUndefined()
      expect(store.getMedicalInfo('u2')).toBeTruthy() // 别人的不动
    })
  }
})
