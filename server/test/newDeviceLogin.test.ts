import { describe, it, expect } from 'vitest'
import { buildApp } from '../src/app'
import { MemoryStore } from '../src/db/store'

/// 新设备登录预警本人（Apple/Google 式接管早期信号）：账号已有其它活跃会话时，从一台**此前没登录过的设备**
/// 登录 → 持久化 `security_new_device` 通知本人（+ best-effort 推送）。首登/同设备重登/续期(refresh)均不报，避免噪音。
describe('新设备登录预警（security_new_device）', () => {
  const store = () => new MemoryStore()
  const login = (a: Awaited<ReturnType<typeof buildApp>>, username: string, deviceName?: string) =>
    a.inject({ method: 'POST', url: '/api/auth/login', payload: { username, password: 'secret123', deviceName } })
  const register = (a: Awaited<ReturnType<typeof buildApp>>, username: string, deviceName?: string) =>
    a.inject({ method: 'POST', url: '/api/auth/register', payload: { username, password: 'secret123', deviceName } })
  const newDeviceNotes = (s: MemoryStore, userId: string) =>
    s.notificationsForUser(userId).filter((n) => n.kind === 'security_new_device')

  it('从另一台设备登录（已有活跃会话）→ 预警本人，文案带设备名', async () => {
    const s = store()
    const a = await buildApp(s)
    const reg = await register(a, 'eve', 'Eve-iPhone') // 注册即建会话1；0 前序会话 → 不报
    const uid = reg.json().user.id
    expect(newDeviceNotes(s, uid)).toHaveLength(0)

    const res = await login(a, 'eve', 'Eve-iPad') // 前序有 Eve-iPhone、无 Eve-iPad → 新设备，预警
    expect(res.statusCode).toBe(200)
    const notes = newDeviceNotes(s, uid)
    expect(notes).toHaveLength(1)
    expect(notes[0].body).toContain('Eve-iPad') // 点明是哪台设备（供本人辨识）
    await a.close()
  })

  it('同一台设备重登（deviceLabel 相同）→ 不重复预警（避免自我噪音）', async () => {
    const s = store()
    const a = await buildApp(s)
    const reg = await register(a, 'eve', 'Eve-iPhone')
    const uid = reg.json().user.id
    await login(a, 'eve', 'Eve-iPad')          // 1 条
    expect(newDeviceNotes(s, uid)).toHaveLength(1)
    await login(a, 'eve', 'Eve-iPhone')        // 既有会话已含 Eve-iPhone → 同设备，抑制
    expect(newDeviceNotes(s, uid)).toHaveLength(1) // 仍是 1，不新增
    await a.close()
  })

  it('全新账号首登（无其它活跃会话）→ 不报', async () => {
    const s = store()
    const a = await buildApp(s)
    const reg = await register(a, 'frank', 'Frank-Phone') // 注册=首个会话，0 前序 → 不报
    const uid = reg.json().user.id
    expect(newDeviceNotes(s, uid)).toHaveLength(0)
    await a.close()
  })

  it('续期(refresh) 延续同一会话 → 不报（只有新登录才报）', async () => {
    const s = store()
    const a = await buildApp(s)
    const reg = await register(a, 'grace', 'Grace-iPhone')
    const uid = reg.json().user.id
    const refreshToken = reg.json().refreshToken
    expect(newDeviceNotes(s, uid)).toHaveLength(0)

    const ref = await a.inject({ method: 'POST', url: '/api/auth/refresh', payload: { refreshToken } })
    expect(ref.statusCode).toBe(200)
    expect(newDeviceNotes(s, uid)).toHaveLength(0) // refresh 走 issueTokens(带 sid)，绝不预警
    await a.close()
  })
})
