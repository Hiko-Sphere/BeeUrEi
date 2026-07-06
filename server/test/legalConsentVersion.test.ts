import { describe, it, expect, afterEach } from 'vitest'
import { buildApp } from '../src/app'
import { MemoryStore } from '../src/db/store'
import { currentLegalVersion } from '../src/routes/appConfig'

// 条款版本 + 重新同意：app-config 下发当前 legalVersion；客户端比对用户已同意版本(me.legalConsentVersion)，
// 不一致则请其重新查看并同意（GDPR 可证明 + 可更新的同意）。
describe('条款版本与重新同意（legalVersion）', () => {
  afterEach(() => { delete process.env.LEGAL_VERSION })

  it('currentLegalVersion：默认 "1"；env 覆盖；空/空白/超长回落 "1"', () => {
    expect(currentLegalVersion(undefined)).toBe('1')
    expect(currentLegalVersion('')).toBe('1')
    expect(currentLegalVersion('   ')).toBe('1')
    expect(currentLegalVersion('2024-06')).toBe('2024-06')
    expect(currentLegalVersion('x'.repeat(20))).toBe('1') // >16 → 回落
  })

  it('app-config 下发 legalVersion（供客户端比对用户已同意版本）', async () => {
    process.env.LEGAL_VERSION = '2'
    const a = buildApp(new MemoryStore())
    const me = (await a.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'legalu', password: 'secret123' } })).json()
    const cfg = (await a.inject({ method: 'GET', url: '/api/app-config', headers: { authorization: `Bearer ${me.token}` } })).json()
    expect(cfg.legalVersion).toBe('2')
    await a.close()
  })

  it('新用户未同意→me.legalConsentVersion 为 null；记录同意后与 app-config 一致（不再提示）', async () => {
    process.env.LEGAL_VERSION = '2'
    const a = buildApp(new MemoryStore())
    const me = (await a.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'legalu2', password: 'secret123' } })).json()
    const auth = { authorization: `Bearer ${me.token}` }
    // 新用户：未记录 → 客户端应请其同意（version !== app-config.legalVersion）。
    expect((await a.inject({ method: 'GET', url: '/api/me', headers: auth })).json().user.legalConsentVersion).toBeNull()
    // 记录同意当前版本。
    const r = await a.inject({ method: 'POST', url: '/api/account/legal-consent', headers: auth, payload: { version: '2' } })
    expect(r.statusCode).toBe(200)
    const meAfter = (await a.inject({ method: 'GET', url: '/api/me', headers: auth })).json().user
    expect(meAfter.legalConsentVersion).toBe('2')  // 已同意 → 与 app-config.legalVersion 一致 → 不再提示
    expect(meAfter.legalConsentAt).toBeTruthy()
    await a.close()
  })
})
