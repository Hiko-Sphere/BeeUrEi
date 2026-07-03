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
    expect(res.json().version).toBe('0.1.0') // 读自 package.json（单一真相）
    expect(res.json().commit).toBe('unknown') // 测试环境未注入 GIT_SHA → 诚实报 unknown 而非假 SHA
    await app.close()
  })
})
