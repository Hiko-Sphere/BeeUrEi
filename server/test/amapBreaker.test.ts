import { describe, it, expect, afterEach, vi } from 'vitest'
import { AmapCircuit, resetAmapBreaker } from '../src/nav/amapClient'
import { buildApp } from '../src/app'
import { MemoryStore, type User } from '../src/db/store'
import { hashPassword } from '../src/auth/passwords'

describe('AmapCircuit 纯状态机', () => {
  it('连续失败达阈值 → open；冷却内快失败；冷却满 → halfOpen 探测', () => {
    const c = new AmapCircuit(3, 1000)
    expect(c.canRequest(0)).toBe(true)
    expect(c.onFailure(0)).toBe(false); expect(c.onFailure(0)).toBe(false) // 2 次仍 closed
    expect(c.stateName).toBe('closed')
    expect(c.onFailure(0)).toBe(true)   // 第 3 次 → 刚跳 open（返回 true 供计数）
    expect(c.stateName).toBe('open')
    expect(c.canRequest(500)).toBe(false)  // 冷却期内：快失败
    expect(c.canRequest(999)).toBe(false)
    expect(c.canRequest(1000)).toBe(true)  // 冷却满：放一个探测 → halfOpen
    expect(c.stateName).toBe('halfOpen')
  })

  it('halfOpen 单探测：转 halfOpen 后其余请求仍快失败（防恢复惊群）', () => {
    const c = new AmapCircuit(2, 1000)
    c.onFailure(0); c.onFailure(0)       // open @0
    expect(c.canRequest(1000)).toBe(true)  // 第一个 → 探测（转 halfOpen）
    expect(c.canRequest(1000)).toBe(false) // 其余 → 快失败（探测未回结果）
    expect(c.canRequest(1001)).toBe(false)
  })

  it('halfOpen 探测成功 → closed（复位）', () => {
    const c = new AmapCircuit(2, 1000)
    c.onFailure(0); c.onFailure(0)      // open
    c.canRequest(1000)                  // → halfOpen
    c.onSuccess()
    expect(c.stateName).toBe('closed')
    expect(c.canRequest(1001)).toBe(true)
  })

  it('halfOpen 探测失败 → 重新 open 且冷却从该刻重算', () => {
    const c = new AmapCircuit(2, 1000)
    c.onFailure(0); c.onFailure(0)      // open @0
    c.canRequest(1000)                  // halfOpen
    expect(c.onFailure(1000)).toBe(true) // 探测失败 → 重新 open @1000
    expect(c.stateName).toBe('open')
    expect(c.canRequest(1500)).toBe(false) // 新冷却期内
    expect(c.canRequest(2000)).toBe(true)  // 新冷却满
  })

  it('中途成功复位失败计数（非连续失败不开路）', () => {
    const c = new AmapCircuit(3, 1000)
    c.onFailure(0); c.onFailure(0)      // 2 次
    c.onSuccess()                       // 复位
    expect(c.onFailure(0)).toBe(false); expect(c.onFailure(0)).toBe(false) // 又 2 次，仍 closed
    expect(c.stateName).toBe('closed')
  })
})

describe('高德熔断集成（HTTP）', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.AMAP_API_KEY; delete process.env.AMAP_BREAKER_THRESHOLD; delete process.env.AMAP_BREAKER_COOLDOWN_MS
    resetAmapBreaker() // 复位模块级熔断器，避免泄漏到其它测试
  })

  it('连续故障达阈值 → 熔断打开、后续请求瞬间快失败（不再打高德）+ 指标计数', async () => {
    process.env.AMAP_API_KEY = 'webkey'
    process.env.AMAP_BREAKER_THRESHOLD = '3'
    process.env.AMAP_BREAKER_COOLDOWN_MS = '30000'
    resetAmapBreaker() // 按新 env 重建

    let fetchCalls = 0
    vi.stubGlobal('fetch', vi.fn(async () => { fetchCalls++; throw new TypeError('network down') }))
    const app = buildApp(new MemoryStore())
    const t = (await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'brk', password: 'a-strong-pass-9', role: 'helper' } })).json().token
    const around = () => app.inject({ method: 'GET', url: '/api/nav/around?lat=39.9&lon=116.4', headers: { authorization: `Bearer ${t}` } })

    // 前 3 次真打高德（每次网络失败 → 重试一次 → 502）；第 3 次令熔断打开。
    for (let i = 0; i < 3; i++) expect((await around()).statusCode).toBe(502)
    const callsAfterOpen = fetchCalls
    expect(callsAfterOpen).toBe(6) // 3 请求 × (首发+重试) = 6 次 fetch

    // 熔断已打开：第 4 次瞬间快失败，**不再调 fetch**，且明确 infocode=breaker_open。
    const rejected = await around()
    expect(rejected.statusCode).toBe(502)
    expect(rejected.json()).toMatchObject({ error: 'amap_error', infocode: 'breaker_open' })
    expect(fetchCalls).toBe(callsAfterOpen) // fetch 未再被调用（快失败）

    const metrics = (await app.inject({ method: 'GET', url: '/metrics' })).body
    expect(metrics).toContain('beeurei_amap_breaker_open_total 1')     // 恰跳一次 open
    expect(metrics).toMatch(/beeurei_amap_breaker_rejected_total [1-9]/) // ≥1 次被快失败拦下
    await app.close()
  })

  it('halfOpen 探测**不重试**（尽快判定恢复；复审 MEDIUM 修复）', async () => {
    process.env.AMAP_API_KEY = 'webkey'
    process.env.AMAP_BREAKER_THRESHOLD = '1'   // 一次失败即开路
    process.env.AMAP_BREAKER_COOLDOWN_MS = '1000' // 短冷却（>=1000 下限）
    resetAmapBreaker()
    let fetchCalls = 0
    vi.stubGlobal('fetch', vi.fn(async () => { fetchCalls++; throw new TypeError('down') }))
    const app = buildApp(new MemoryStore())
    const t = (await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'brk3', password: 'a-strong-pass-9', role: 'helper' } })).json().token
    const around = () => app.inject({ method: 'GET', url: '/api/nav/around?lat=39.9&lon=116.4', headers: { authorization: `Bearer ${t}` } })

    await around() // 第一次：closed → 网络失败会重试 → 2 次 fetch，然后开路
    expect(fetchCalls).toBe(2)
    await new Promise((r) => setTimeout(r, 1100)) // 等冷却过（>1000ms）
    const before = fetchCalls
    await around() // halfOpen 探测：**不重试** → 只 1 次 fetch
    expect(fetchCalls).toBe(before + 1)
    await app.close()
  })

  it('未达阈值不打开：成功穿插时不误熔断', async () => {
    process.env.AMAP_API_KEY = 'webkey'
    process.env.AMAP_BREAKER_THRESHOLD = '3'
    resetAmapBreaker()
    let n = 0
    // 第 3 次 fetch 成功、其余失败。熔断按**请求**计：请求1失败(fetch1+重试fetch2)→计1；请求2的首发 fetch3 成功→复位0；
    // 请求3失败→计1。故失败计数从未连续达 3 → 不熔断。
    vi.stubGlobal('fetch', vi.fn(async () => {
      n++
      if (n === 3) return { ok: true, status: 200, json: async () => ({ status: '1', infocode: '10000', pois: [] }) }
      throw new TypeError('blip')
    }))
    const app = buildApp(new MemoryStore())
    const t = (await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'brk2', password: 'a-strong-pass-9', role: 'helper' } })).json().token
    const around = () => app.inject({ method: 'GET', url: '/api/nav/around?lat=39.9&lon=116.4', headers: { authorization: `Bearer ${t}` } })
    // 注：网络失败会重试一次，故第 3 次 fetch 落在第 2 个请求的重试上 → 该请求成功，复位计数。
    await around(); await around(); await around()
    const metrics = (await app.inject({ method: 'GET', url: '/metrics' })).body
    expect(metrics).toContain('beeurei_amap_breaker_open_total 0') // 从未熔断
    await app.close()
  })

  it('admin 概览 amap.breakerState 反映**实时**熔断状态（closed→open）——运维据此判断"导航此刻是否挂了"', async () => {
    process.env.AMAP_API_KEY = 'webkey'
    process.env.AMAP_BREAKER_THRESHOLD = '2'
    process.env.AMAP_BREAKER_COOLDOWN_MS = '30000'
    resetAmapBreaker()
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network down') }))

    const store = new MemoryStore()
    const admin: User = { id: 'a1', username: 'root', passwordHash: hashPassword('rootpass1'), displayName: 'root', role: 'admin', status: 'active', createdAt: Date.now() }
    store.createUser(admin)
    const app = buildApp(store)
    const adminTok = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'root', password: 'rootpass1' } })).json().token as string
    const overview = async () => (await app.inject({ method: 'GET', url: '/api/admin/overview', headers: { authorization: `Bearer ${adminTok}` } })).json()

    // 初始：熔断闭合 → 概览如实报 'closed'（证伪：字段被硬编码为 'open' 时此断言红）。
    expect((await overview()).amap.breakerState).toBe('closed')

    // 连打两次导航令高德连续失败 → 阈值 2 → 熔断打开。
    const u = (await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'brkov', password: 'a-strong-pass-9', role: 'helper' } })).json().token
    const around = () => app.inject({ method: 'GET', url: '/api/nav/around?lat=39.9&lon=116.4', headers: { authorization: `Bearer ${u}` } })
    expect((await around()).statusCode).toBe(502)
    expect((await around()).statusCode).toBe(502)

    // 熔断已 open → 概览实时反映 'open'（证伪：字段被硬编码 'closed' 或删除→此断言红）。
    expect((await overview()).amap.breakerState).toBe('open')
    await app.close()
  })
})
