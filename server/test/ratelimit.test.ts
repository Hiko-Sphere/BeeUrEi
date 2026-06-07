import { describe, it, expect } from 'vitest'
import { buildApp } from '../src/app'
import { MemoryStore } from '../src/db/store'

describe('rate limiting', () => {
  it('returns 429 after exceeding the limit', async () => {
    const app = buildApp(new MemoryStore(), { rateLimitMax: 3 })
    const codes: number[] = []
    for (let i = 0; i < 4; i++) {
      const res = await app.inject({ method: 'GET', url: '/health' })
      codes.push(res.statusCode)
    }
    expect(codes.filter((c) => c === 200).length).toBe(3)
    expect(codes[3]).toBe(429)
    await app.close()
  })
})
