import { describe, it, expect } from 'vitest'
import { buildApp } from '../src/app'
import { MemoryStore } from '../src/db/store'

function app() {
  return buildApp(new MemoryStore())
}

describe('auth + accounts', () => {
  it('register returns token + user with default role blind', async () => {
    const a = app()
    const res = await a.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { username: 'alice', password: 'secret123' },
    })
    expect(res.statusCode).toBe(201)
    const body = res.json()
    expect(body.token).toBeTruthy()
    expect(body.user).toMatchObject({ username: 'alice', role: 'blind', status: 'active' })
    expect(body.user.passwordHash).toBeUndefined()
    await a.close()
  })

  it('rejects short input and duplicate username', async () => {
    const a = app()
    const bad = await a.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'a', password: '1' } })
    expect(bad.statusCode).toBe(400)

    await a.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'bob', password: 'secret123' } })
    const dup = await a.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'bob', password: 'secret123' } })
    expect(dup.statusCode).toBe(409)
    await a.close()
  })

  it('login succeeds with correct password, fails otherwise', async () => {
    const a = app()
    await a.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'carol', password: 'secret123', role: 'helper' } })

    const ok = await a.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'carol', password: 'secret123' } })
    expect(ok.statusCode).toBe(200)
    expect(ok.json().user.role).toBe('helper')

    const wrong = await a.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'carol', password: 'nope' } })
    expect(wrong.statusCode).toBe(401)
    await a.close()
  })

  it('/api/me requires a valid token', async () => {
    const a = app()
    const reg = await a.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'dave', password: 'secret123' } })
    const token = reg.json().token

    const noAuth = await a.inject({ method: 'GET', url: '/api/me' })
    expect(noAuth.statusCode).toBe(401)

    const withAuth = await a.inject({ method: 'GET', url: '/api/me', headers: { authorization: `Bearer ${token}` } })
    expect(withAuth.statusCode).toBe(200)
    expect(withAuth.json().user.username).toBe('dave')
    await a.close()
  })
})
