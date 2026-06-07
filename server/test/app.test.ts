import { describe, it, expect } from 'vitest'
import { buildApp } from '../src/app'

describe('server skeleton', () => {
  it('GET /health returns ok', async () => {
    const app = buildApp()
    const res = await app.inject({ method: 'GET', url: '/health' })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toMatchObject({ status: 'ok' })
    await app.close()
  })

  it('GET /api/version returns version', async () => {
    const app = buildApp()
    const res = await app.inject({ method: 'GET', url: '/api/version' })
    expect(res.statusCode).toBe(200)
    expect(res.json().version).toBe('0.1.0')
    await app.close()
  })
})
