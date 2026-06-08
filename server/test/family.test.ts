import { describe, it, expect } from 'vitest'
import { buildApp } from '../src/app'
import { MemoryStore } from '../src/db/store'

function setup() {
  const a = buildApp(new MemoryStore())
  const reg = async (username: string, role?: string) =>
    (await a.inject({ method: 'POST', url: '/api/auth/register', payload: { username, password: 'secret123', role } })).json()
  return { a, reg }
}

describe('family + emergency', () => {
  it('add / list / delete links and emergency routing order', async () => {
    const { a, reg } = setup()
    const owner = await reg('alice')
    await reg('mom', 'family')
    await reg('friend', 'helper')
    const auth = { authorization: `Bearer ${owner.token}` }

    const l1 = await a.inject({ method: 'POST', url: '/api/family/links', headers: auth, payload: { username: 'mom', relation: '妈妈', isEmergency: true, phone: '13800000000' } })
    expect(l1.statusCode).toBe(201)
    expect(l1.json().link.memberName).toBe('mom')
    expect(l1.json().link.phone).toBe('13800000000') // 电话兜底

    await a.inject({ method: 'POST', url: '/api/family/links', headers: auth, payload: { username: 'friend' } })

    const ghost = await a.inject({ method: 'POST', url: '/api/family/links', headers: auth, payload: { username: 'ghost' } })
    expect(ghost.statusCode).toBe(404)

    const list = await a.inject({ method: 'GET', url: '/api/family/links', headers: auth })
    expect(list.json().links.length).toBe(2)

    const trig = await a.inject({ method: 'POST', url: '/api/emergency/trigger', headers: auth })
    const targets = trig.json().targets
    expect(targets.length).toBe(2)
    expect(targets[0].memberName).toBe('mom')
    expect(targets[0].isEmergency).toBe(true)

    const id = list.json().links[0].id
    const del = await a.inject({ method: 'DELETE', url: `/api/family/links/${id}`, headers: auth })
    expect(del.statusCode).toBe(204)
    await a.close()
  })

  it('rejects linking self and requires auth', async () => {
    const { a, reg } = setup()
    const owner = await reg('alice')
    const auth = { authorization: `Bearer ${owner.token}` }
    const self = await a.inject({ method: 'POST', url: '/api/family/links', headers: auth, payload: { username: 'alice' } })
    expect(self.statusCode).toBe(400)

    const noAuth = await a.inject({ method: 'GET', url: '/api/family/links' })
    expect(noAuth.statusCode).toBe(401)
    await a.close()
  })
})
