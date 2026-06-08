import { describe, it, expect } from 'vitest'
import { buildApp } from '../src/app'
import { MemoryStore } from '../src/db/store'

function app() {
  return buildApp(new MemoryStore())
}

async function register(a: ReturnType<typeof buildApp>, username = 'rina') {
  const res = await a.inject({ method: 'POST', url: '/api/auth/register', payload: { username, password: 'secret123' } })
  return res.json() as { token: string; refreshToken: string; user: { id: string } }
}

describe('refresh token', () => {
  it('register/login return both access + refresh tokens', async () => {
    const a = app()
    const body = await register(a)
    expect(body.token).toBeTruthy()
    expect(body.refreshToken).toBeTruthy()
    expect(body.refreshToken.length).toBeGreaterThanOrEqual(32)
    await a.close()
  })

  it('refresh issues a new pair and rotates (old refresh invalid)', async () => {
    const a = app()
    const { refreshToken } = await register(a)

    const r1 = await a.inject({ method: 'POST', url: '/api/auth/refresh', payload: { refreshToken } })
    expect(r1.statusCode).toBe(200)
    const b1 = r1.json()
    expect(b1.token).toBeTruthy()
    expect(b1.refreshToken).toBeTruthy()
    expect(b1.refreshToken).not.toBe(refreshToken) // 轮换

    // 旧 refresh 已作废
    const reused = await a.inject({ method: 'POST', url: '/api/auth/refresh', payload: { refreshToken } })
    expect(reused.statusCode).toBe(401)

    // 新 refresh 可用
    const r2 = await a.inject({ method: 'POST', url: '/api/auth/refresh', payload: { refreshToken: b1.refreshToken } })
    expect(r2.statusCode).toBe(200)
    await a.close()
  })

  it('invalid refresh token → 401', async () => {
    const a = app()
    const res = await a.inject({ method: 'POST', url: '/api/auth/refresh', payload: { refreshToken: 'nope' } })
    expect(res.statusCode).toBe(401)
    await a.close()
  })

  it('logout revokes the refresh token', async () => {
    const a = app()
    const { refreshToken } = await register(a)
    const out = await a.inject({ method: 'POST', url: '/api/auth/logout', payload: { refreshToken } })
    expect(out.statusCode).toBe(204)
    const after = await a.inject({ method: 'POST', url: '/api/auth/refresh', payload: { refreshToken } })
    expect(after.statusCode).toBe(401)
    await a.close()
  })
})
