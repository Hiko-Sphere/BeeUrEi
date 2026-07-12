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

  it('验证码端点 /api/account/email/verify 有端点级限流（挡猜码；补齐与其它验证码端点的纵深一致性）', async () => {
    const app = buildApp(new MemoryStore()) // 用端点自带的 10/min 限额（非全局），验证真挡住连续猜码
    const me = (await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'emverify', password: 'secret123' } })).json()
    const auth = { authorization: `Bearer ${me.token}` }
    let limited = false
    for (let i = 0; i < 12; i++) { // 端点限额 10/min：第 11 次起应 429（改前无端点限流、全局 300 内不会 429，测即失败）
      if ((await app.inject({ method: 'POST', url: '/api/account/email/verify', headers: auth, payload: { code: '000000' } })).statusCode === 429) { limited = true; break }
    }
    expect(limited).toBe(true)
    await app.close()
  })

  it('头像端点有端点级限流（20/min）——挡住每次 600KB 大写的写放大 DoS（改前无端点限流、全局 300 内不会 429）', async () => {
    const app = buildApp(new MemoryStore())
    const me = (await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'avataruser', password: 'secret123' } })).json()
    const auth = { authorization: `Bearer ${me.token}` }
    const avatar = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg=='
    let limited = false
    for (let i = 0; i < 22; i++) { // 端点限额 20/min：第 21 次起应 429
      if ((await app.inject({ method: 'POST', url: '/api/account/avatar', headers: auth, payload: { avatar } })).statusCode === 429) { limited = true; break }
    }
    expect(limited).toBe(true)
    await app.close()
  })

  it('未登录流量按真实客户端隔离：隧道后两客户端各自的桶——A(CF-IP) 打满不波及 B（防登录 DoS）', async () => {
    // 生产在 Cloudflare 隧道后，inject 的 req.ip 恒为环回；此前未登录直接用 req.ip → 全站共享一个桶，
    // 一人打满即所有人被限（登录 DoS）。现按 CF-Connecting-IP（对端私网才信）分桶。用走**全局** max
    // 的 /health（无 per-route 限流覆盖）验分桶：A 请求 4 次（超 max=3）→ 429；B 首请求仍 200。
    const app = buildApp(new MemoryStore(), { rateLimitMax: 3 })
    const hit = (cfip: string) => app.inject({ method: 'GET', url: '/health', headers: { 'cf-connecting-ip': cfip } })
    const codesA: number[] = []
    for (let i = 0; i < 4; i++) codesA.push((await hit('203.0.113.10')).statusCode)
    expect(codesA.filter((c) => c === 200).length).toBe(3) // 客户端 A（一个真实 IP）自己的桶：前 3 通
    expect(codesA[3]).toBe(429)                             // 第 4 次触上限
    expect((await hit('198.51.100.20')).statusCode).toBe(200) // 客户端 B 独立分桶——共享一个 IP 桶则也会 429
    await app.close()
  })
})
