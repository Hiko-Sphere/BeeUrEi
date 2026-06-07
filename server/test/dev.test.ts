import { describe, it, expect } from 'vitest'
import { buildApp } from '../src/app'
import { MemoryStore, type User } from '../src/db/store'
import { hashPassword } from '../src/auth/passwords'

function makeUser(username: string, role: User['role']): User {
  return { id: username, username, passwordHash: hashPassword('devpass12'), displayName: username, role, status: 'active', createdAt: Date.now() }
}

describe('developer endpoints', () => {
  it('require developer role', async () => {
    const store = new MemoryStore()
    store.createUser(makeUser('dev', 'developer'))
    const app = buildApp(store)

    const reg = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'plain', password: 'secret123' } })
    const plain = reg.json().token
    const denied = await app.inject({ method: 'GET', url: '/api/dev/ping', headers: { authorization: `Bearer ${plain}` } })
    expect(denied.statusCode).toBe(403)

    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'dev', password: 'devpass12' } })
    const devToken = login.json().token
    const ping = await app.inject({ method: 'GET', url: '/api/dev/ping', headers: { authorization: `Bearer ${devToken}` } })
    expect(ping.statusCode).toBe(200)
    expect(ping.json().ok).toBe(true)

    const stats = await app.inject({ method: 'GET', url: '/api/dev/stats', headers: { authorization: `Bearer ${devToken}` } })
    expect(stats.json().users).toBeGreaterThanOrEqual(2)
    await app.close()
  })
})
