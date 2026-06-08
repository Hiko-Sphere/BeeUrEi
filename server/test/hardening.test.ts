import { describe, it, expect } from 'vitest'
import { buildApp } from '../src/app'
import { MemoryStore } from '../src/db/store'

function app() {
  return buildApp(new MemoryStore())
}

describe('production hardening', () => {
  it('readiness probe returns ready', async () => {
    const a = app()
    const res = await a.inject({ method: 'GET', url: '/api/ready' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ ready: true })
    await a.close()
  })

  it('unknown route returns clean 404 JSON', async () => {
    const a = app()
    const res = await a.inject({ method: 'GET', url: '/api/does-not-exist' })
    expect(res.statusCode).toBe(404)
    expect(res.json()).toEqual({ error: 'not_found' })
    await a.close()
  })
})
