import { describe, it, expect } from 'vitest'
import { buildApp } from '../src/app'
import { MemoryStore } from '../src/db/store'
import { hashPassword } from '../src/auth/passwords'
import { passwordPolicyError } from '../src/auth/passwordPolicy'

// 口令策略（NIST 800-63B）：≥8 + 常见弱口令拒绝；四路设密同策；老短密码照常登录（免迁移）。
describe('口令策略', () => {
  it('纯函数：短→too_short；常见→too_common（大小写不敏感）；强 passphrase 通过', () => {
    expect(passwordPolicyError('a1b2c3')).toBe('password_too_short')          // 6 位（旧下限）不再够
    expect(passwordPolicyError('12345678')).toBe('password_too_common')
    expect(passwordPolicyError('PASSWORD123')).toBe('password_too_common')    // 大小写不敏感
    expect(passwordPolicyError('woaini1314')).toBe('password_too_common')     // 中文语境高频
    expect(passwordPolicyError('正确马电池订书钉')).toBeNull()                  // passphrase 友好
    expect(passwordPolicyError('tr0ub4dor&3x')).toBeNull()
  })

  it('注册：弱口令拒绝并给具体错误码；强口令通过', async () => {
    const a = buildApp(new MemoryStore())
    const reg = (pw: string) => a.inject({ method: 'POST', url: '/api/auth/register',
      payload: { username: 'pwuser' + pw.length, password: pw, role: 'helper' } })
    expect((await reg('short1')).statusCode).toBe(400)
    expect((await reg('short1')).json().error).toBe('password_too_short')
    const common = await a.inject({ method: 'POST', url: '/api/auth/register',
      payload: { username: 'pwcommon', password: 'password123', role: 'helper' } })
    expect(common.json().error).toBe('password_too_common')
    expect((await reg('a-strong-pass-9')).statusCode).toBe(201)
    await a.close()
  })

  it('改密/管理员代设同策拒绝弱口令；**老 6 位密码照常登录**（策略只管新设，免迁移）', async () => {
    const store = new MemoryStore()
    // 直接种一个旧标准（6 位）账号——模拟策略收紧前注册的存量用户。
    store.createUser({ id: 'old1', username: 'olduser', passwordHash: hashPassword('old6pw'),
      displayName: 'old', role: 'helper', status: 'active', createdAt: 1 })
    store.createUser({ id: 'adm1', username: 'root', passwordHash: hashPassword('secret123'),
      displayName: 'root', role: 'admin', status: 'active', createdAt: 1 })
    const a = buildApp(store)
    // 老密码登录不受影响
    const login = await a.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'olduser', password: 'old6pw' } })
    expect(login.statusCode).toBe(200)
    const t = login.json().token
    // 但改密要过新策略
    const weak = await a.inject({ method: 'POST', url: '/api/account/password', headers: { authorization: `Bearer ${t}` },
      payload: { oldPassword: 'old6pw', newPassword: 'qwerty123' } })
    expect(weak.json().error).toBe('password_too_common')
    // 管理员代设同策
    const at = (await a.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'root', password: 'secret123' } })).json().token
    const adminWeak = await a.inject({ method: 'POST', url: '/api/admin/users/old1/reset-password',
      headers: { authorization: `Bearer ${at}` }, payload: { newPassword: '1234567' } })
    expect(adminWeak.json().error).toBe('password_too_short')
    await a.close()
  })
})
