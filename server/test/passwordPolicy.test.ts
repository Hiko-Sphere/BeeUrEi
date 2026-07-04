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

  it('纯函数：平凡结构（全同/顺序/短单元重复）归为 too_common', () => {
    expect(passwordPolicyError('aaaaaaaa')).toBe('password_too_common')      // 全同字符
    expect(passwordPolicyError('abcdefgh')).toBe('password_too_common')      // 单调递增
    expect(passwordPolicyError('hgfedcba')).toBe('password_too_common')      // 单调递减
    expect(passwordPolicyError('abcabcabc')).toBe('password_too_common')     // 短单元 x3
    expect(passwordPolicyError('xy9xy9xy9xy9')).toBe('password_too_common')  // 单元 x4
    expect(passwordPolicyError('wordword')).toBeNull()                       // 单元仅 x2 → 不误伤
    expect(passwordPolicyError('tr0ub4dor&3x')).toBeNull()
  })

  it('纯函数：上下文相似（口令即身份字段或其去数字派生）→ too_similar', () => {
    expect(passwordPolicyError('alice123', { username: 'alice' })).toBe('password_too_similar')   // 用户名+数字尾
    expect(passwordPolicyError('2026alice', { username: 'alice' })).toBe('password_too_similar')  // 数字前缀+用户名
    expect(passwordPolicyError('bob123456', { username: 'bob' })).toBe('password_too_similar')    // 3 字用户名也纳入（公开可猜）
    expect(passwordPolicyError('beeurei-2026', {})).toBe('password_too_similar')                  // 应用名核
    expect(passwordPolicyError('johnsmith99', { email: 'johnsmith@x.com' })).toBe('password_too_similar') // 邮箱本地部分核
    expect(passwordPolicyError('winterhaven', { email: 'winterhaven-lodge@x.com' })).toBe('password_too_similar') // 口令是更长本地部分的子串
    expect(passwordPolicyError('alice123')).toBeNull() // 不传 ctx → 不判相似
  })

  it('纯函数：**不误伤**——强口令仅碰巧含短片段/用户名，非派生（对抗复审 HIGH：勿一刀切裸子串）', () => {
    expect(passwordPolicyError('Reinforcement-7x', { email: 'info@x.com' })).toBeNull()   // 含 info 但非派生
    expect(passwordPolicyError('bookmark-harbor-92', { username: 'mark' })).toBeNull()    // 含 mark 但非派生
    expect(passwordPolicyError('alice2026wonderland', { username: 'alice' })).toBeNull()  // 含 alice 但有额外熵
    expect(passwordPolicyError('Trustworthy-Mule-7', { email: 'user@x.com' })).toBeNull() // 含 user（trUSTworthy…）但非派生
    expect(passwordPolicyError('unrelated-strong-9', { username: 'alice', email: 'bob@x.com' })).toBeNull()
    expect(passwordPolicyError('xy-strong-pass-9', { username: 'xy' })).toBeNull()        // 用户名 <3 不作词元
  })

  it('注册：把用户名当密码被拒（too_similar）', async () => {
    const a = buildApp(new MemoryStore())
    const res = await a.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'zhangwei', password: 'zhangwei99', role: 'helper' } })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('password_too_similar')
    await a.close()
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
