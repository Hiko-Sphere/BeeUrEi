import { describe, it, expect } from 'vitest'
import { buildApp } from '../src/app'
import { MemoryStore } from '../src/db/store'

function app() {
  return buildApp(new MemoryStore())
}

async function token(a: ReturnType<typeof buildApp>, username: string) {
  const r = await a.inject({ method: 'POST', url: '/api/auth/register', payload: { username, password: 'secret123' } })
  return r.json().token as string
}

describe('reports', () => {
  it('logged-in user can submit a report', async () => {
    const a = app()
    const t = await token(a, 'reporter1')
    const res = await a.inject({
      method: 'POST', url: '/api/reports',
      headers: { authorization: `Bearer ${t}` },
      payload: { targetUserId: 'someone', callId: 'c1', reason: '骚扰' },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().report).toMatchObject({ targetUserId: 'someone', status: 'open', reason: '骚扰' })
    await a.close()
  })

  it('dedupes repeated open reports against the same target', async () => {
    const a = app()
    const t = await token(a, 'reporter3')
    const auth = { authorization: `Bearer ${t}` }
    const r1 = await a.inject({ method: 'POST', url: '/api/reports', headers: auth, payload: { targetUserId: 'same', reason: 'a' } })
    expect(r1.statusCode).toBe(201)
    const r2 = await a.inject({ method: 'POST', url: '/api/reports', headers: auth, payload: { targetUserId: 'same', reason: 'b' } })
    expect(r2.statusCode).toBe(200)
    expect(r2.json().deduped).toBe(true)
    expect(r2.json().report.id).toBe(r1.json().report.id)
    await a.close()
  })

  it('requires auth', async () => {
    const a = app()
    const res = await a.inject({ method: 'POST', url: '/api/reports', payload: { targetUserId: 'x', reason: 'y' } })
    expect(res.statusCode).toBe(401)
    await a.close()
  })

  it('validates input', async () => {
    const a = app()
    const t = await token(a, 'reporter2')
    const res = await a.inject({
      method: 'POST', url: '/api/reports',
      headers: { authorization: `Bearer ${t}` },
      payload: { reason: '' },
    })
    expect(res.statusCode).toBe(400)
    await a.close()
  })
})
