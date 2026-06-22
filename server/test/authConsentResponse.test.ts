import { describe, it, expect } from 'vitest'
import { buildApp } from '../src/app'
import { MemoryStore } from '../src/db/store'

/// 回归：登录/注册/刷新的响应 user 必须携带 legalConsentVersion（来自 selfView，非 publicUser）。
/// 否则 access token 过期后客户端走 refresh 拿到的 user 缺该字段 → needsLegalConsent 误判 →
/// "每次打开 app 都要重新同意法律文件"。这正是用户反馈的 bug。
describe('auth 响应携带法律同意版本（修复重复同意 bug）', () => {
  it('register/login/refresh 的 user 均含 legalConsentVersion，且记录同意后正确回传', async () => {
    const app = buildApp(new MemoryStore())

    // 注册：响应 user 含 legalConsentVersion 字段（尚未同意 → null）。
    const reg = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'consentu', password: 'secret123', role: 'blind' } })
    expect(reg.statusCode).toBe(201)
    const regBody = reg.json()
    expect(regBody.user).toHaveProperty('legalConsentVersion')
    expect(regBody.user.legalConsentVersion).toBeNull()
    const token = regBody.token as string

    // 记录同意当前版本。
    const consent = await app.inject({ method: 'POST', url: '/api/account/legal-consent', headers: { authorization: `Bearer ${token}` }, payload: { version: '3.0' } })
    expect(consent.statusCode).toBe(200)

    // 重新登录：响应 user.legalConsentVersion === '3.0'（不再丢失 → 不会误触发重新同意）。
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'consentu', password: 'secret123' } })
    expect(login.statusCode).toBe(200)
    expect(login.json().user.legalConsentVersion).toBe('3.0')

    // 用 refresh token 换新（access 过期路径）：响应 user 仍含 legalConsentVersion === '3.0'。
    const refreshToken = login.json().refreshToken as string
    const refreshed = await app.inject({ method: 'POST', url: '/api/auth/refresh', payload: { refreshToken } })
    expect(refreshed.statusCode).toBe(200)
    expect(refreshed.json().user.legalConsentVersion).toBe('3.0')

    await app.close()
  })
})
