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

  it('已登录请求按用户(sub)隔离限流：A 打满自己额度不波及 B（若按 IP 全站共桶则 B 也会 429）', async () => {
    const app = buildApp(new MemoryStore(), { rateLimitMax: 3 })
    const reg = async (u: string) => (await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: u, password: 'secret123' } })).json()
    const a = await reg('rlusera') // 注册为未登录请求，按 IP 计数，与下面的 authed(按 sub)分桶
    const b = await reg('rluserb')
    const meGet = (tok: string) => app.inject({ method: 'GET', url: '/api/me', headers: { authorization: `Bearer ${tok}` } })
    let aLimited = false
    for (let i = 0; i < 6; i++) { if ((await meGet(a.token)).statusCode === 429) { aLimited = true; break } }
    expect(aLimited).toBe(true)                          // A 触到自己(u:A)的上限
    expect((await meGet(b.token)).statusCode).toBe(200)  // B(u:B)独立分桶、不受 A 影响——按 sub 隔离的证据
    await app.close()
  })
})
