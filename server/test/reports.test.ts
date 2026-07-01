import { describe, it, expect } from 'vitest'
import { buildApp } from '../src/app'
import { MemoryStore } from '../src/db/store'

function app() {
  return buildApp(new MemoryStore())
}

async function reg(a: ReturnType<typeof buildApp>, username: string) {
  const r = await a.inject({ method: 'POST', url: '/api/auth/register', payload: { username, password: 'secret123' } })
  const j = r.json() as { token: string; user: { id: string } }
  return { token: j.token, id: j.user.id }
}

describe('reports', () => {
  it('logged-in user can submit a report against a real target', async () => {
    const a = app()
    const reporter = await reg(a, 'reporter1')
    const target = await reg(a, 'target1')
    const res = await a.inject({
      method: 'POST', url: '/api/reports',
      headers: { authorization: `Bearer ${reporter.token}` },
      payload: { targetUserId: target.id, callId: 'c1', reason: '骚扰' },
    })
    expect(res.statusCode).toBe(201)
    expect(res.json().report).toMatchObject({ targetUserId: target.id, status: 'open', reason: '骚扰' })
    await a.close()
  })

  it('dedupes repeated open reports against the same target', async () => {
    const a = app()
    const reporter = await reg(a, 'reporter3')
    const target = await reg(a, 'target3')
    const auth = { authorization: `Bearer ${reporter.token}` }
    const r1 = await a.inject({ method: 'POST', url: '/api/reports', headers: auth, payload: { targetUserId: target.id, reason: 'a' } })
    expect(r1.statusCode).toBe(201)
    const r2 = await a.inject({ method: 'POST', url: '/api/reports', headers: auth, payload: { targetUserId: target.id, reason: 'b' } })
    expect(r2.statusCode).toBe(200)
    expect(r2.json().deduped).toBe(true)
    expect(r2.json().report.id).toBe(r1.json().report.id)
    await a.close()
  })

  it('拒绝举报不存在的用户（防伪造 targetUserId 绕过去重灌报）', async () => {
    const a = app()
    const reporter = await reg(a, 'reporter4')
    const res = await a.inject({ method: 'POST', url: '/api/reports',
      headers: { authorization: `Bearer ${reporter.token}` }, payload: { targetUserId: 'ghost-id-nope', reason: 'x' } })
    expect(res.statusCode).toBe(404)
    expect(res.json().error).toBe('target_not_found')
    await a.close()
  })

  it('拒绝举报自己', async () => {
    const a = app()
    const reporter = await reg(a, 'reporter5')
    const res = await a.inject({ method: 'POST', url: '/api/reports',
      headers: { authorization: `Bearer ${reporter.token}` }, payload: { targetUserId: reporter.id, reason: 'x' } })
    expect(res.statusCode).toBe(400)
    expect(res.json().error).toBe('cannot_report_self')
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
    const reporter = await reg(a, 'reporter2')
    const res = await a.inject({
      method: 'POST', url: '/api/reports',
      headers: { authorization: `Bearer ${reporter.token}` },
      payload: { reason: '' },
    })
    expect(res.statusCode).toBe(400)
    await a.close()
  })
})
