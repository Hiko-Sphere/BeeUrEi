import { describe, it, expect } from 'vitest'
import { buildApp } from '../src/app'
import { MemoryStore } from '../src/db/store'

function app() { return buildApp(new MemoryStore()) }
const auth = (t: string) => ({ authorization: `Bearer ${t}` })

async function reg(a: ReturnType<typeof buildApp>, username: string, headers: Record<string, string> = {}) {
  const r = await a.inject({ method: 'POST', url: '/api/auth/register', headers, payload: { username, password: 'secret123' } })
  return r.json() as { token: string; refreshToken: string }
}
async function login(a: ReturnType<typeof buildApp>, username: string, headers: Record<string, string> = {}) {
  const r = await a.inject({ method: 'POST', url: '/api/auth/login', headers, payload: { username, password: 'secret123' } })
  return r.json() as { token: string; refreshToken: string }
}

describe('login sessions / device management', () => {
  it('lists sessions per device and marks the current one', async () => {
    const a = app()
    const reg1 = await reg(a, 'sess1', { 'user-agent': 'Mozilla/5.0 (Macintosh) Chrome/120' })
    await login(a, 'sess1', { 'user-agent': 'BeeUrEi/1.0 (iPhone)' })

    const res = await a.inject({ method: 'GET', url: '/api/account/sessions', headers: auth(reg1.token) })
    const { sessions } = res.json() as { sessions: { sessionId: string; deviceLabel?: string; current: boolean }[] }
    expect(sessions.length).toBe(2)
    expect(sessions.filter((s) => s.current)).toHaveLength(1)
    // 设备标签从 UA 推断
    expect(sessions.some((s) => /Chrome|Mac/.test(s.deviceLabel ?? ''))).toBe(true)
    expect(sessions.some((s) => /BeeUrEi|iPhone/.test(s.deviceLabel ?? ''))).toBe(true)
    await a.close()
  })

  it('revoke-others kills other devices immediately (their access token is rejected), keeps current', async () => {
    const a = app()
    const first = await reg(a, 'sess2')
    const second = await login(a, 'sess2')

    // second 这台还能用
    expect((await a.inject({ method: 'GET', url: '/api/me', headers: auth(second.token) })).statusCode).toBe(200)

    // 用 first 登出其它设备
    const ro = await a.inject({ method: 'POST', url: '/api/account/sessions/revoke-others', headers: auth(first.token) })
    expect(ro.statusCode).toBe(200)

    // second 的 access token 立即失效（会话已撤销）
    const after = await a.inject({ method: 'GET', url: '/api/me', headers: auth(second.token) })
    expect(after.statusCode).toBe(401)
    expect((after.json() as any).error).toBe('session_revoked')

    // first 仍有效，且只剩 1 个会话
    expect((await a.inject({ method: 'GET', url: '/api/me', headers: auth(first.token) })).statusCode).toBe(200)
    const list = await a.inject({ method: 'GET', url: '/api/account/sessions', headers: auth(first.token) })
    expect((list.json() as { sessions: unknown[] }).sessions.length).toBe(1)
    await a.close()
  })

  it('revoke a specific session by id; refresh of a revoked session fails', async () => {
    const a = app()
    const first = await reg(a, 'sess3')
    const second = await login(a, 'sess3')

    const list = await a.inject({ method: 'GET', url: '/api/account/sessions', headers: auth(first.token) })
    const { sessions } = list.json() as { sessions: { sessionId: string; current: boolean }[] }
    const other = sessions.find((s) => !s.current)!
    const rv = await a.inject({ method: 'POST', url: '/api/account/sessions/revoke', headers: auth(first.token), payload: { sessionId: other.sessionId } })
    expect(rv.statusCode).toBe(200)

    // 被撤销会话的 refresh token 也不能再续期
    const refreshed = await a.inject({ method: 'POST', url: '/api/auth/refresh', payload: { refreshToken: second.refreshToken } })
    expect(refreshed.statusCode).toBe(401)
    await a.close()
  })

  it('refresh keeps the same session (sessionId stable across rotation)', async () => {
    const a = app()
    const r = await reg(a, 'sess4')
    const before = await a.inject({ method: 'GET', url: '/api/account/sessions', headers: auth(r.token) })
    const sidBefore = (before.json() as { sessions: { sessionId: string }[] }).sessions[0].sessionId

    const refreshed = await a.inject({ method: 'POST', url: '/api/auth/refresh', payload: { refreshToken: r.refreshToken } })
    expect(refreshed.statusCode).toBe(200)
    const newToken = (refreshed.json() as { token: string }).token

    const after = await a.inject({ method: 'GET', url: '/api/account/sessions', headers: auth(newToken) })
    const list = (after.json() as { sessions: { sessionId: string }[] }).sessions
    expect(list.length).toBe(1)              // 仍是同一个会话，不是新增
    expect(list[0].sessionId).toBe(sidBefore)
    await a.close()
  })
})
