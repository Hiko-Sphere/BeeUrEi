import { describe, it, expect, vi, afterEach } from 'vitest'
import { buildApp } from '../src/app'
import { MemoryStore } from '../src/db/store'
import { hashPassword } from '../src/auth/passwords'

// 高德是限额/计费外部依赖：调用量/超时/网络失败/上游错误(key 平台不符·配额)必须可观测。
// 经 PUT /api/places/:label（best-effort geocode，无论成败都走 amapFetch）触发真实调用路径，
// 再抓 /metrics 断言 amap_* 计数——metering 在 amapFetch/assertAmapOk 内，路由吞掉错误也照计。
async function setup() {
  const store = new MemoryStore()
  const app = buildApp(store) // buildApp 里 setAmapMetrics 把模块级钩子指向本 app 的 metrics
  const reg = (await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'amapu', password: 'secret123', role: 'blind' } })).json()
  const h = { authorization: `Bearer ${reg.token}` }
  return { app, h }
}

// 从 Prometheus 文本抓某计数当前值（基线预置 0，故任何时刻该 series 都存在）。
function counter(body: string, name: string): number {
  const m = body.match(new RegExp(`beeurei_${name} (\\d+)`))
  return m ? Number(m[1]) : NaN
}
async function amapCounters(app: Awaited<ReturnType<typeof setup>>['app']) {
  const body = (await app.inject({ method: 'GET', url: '/metrics' })).body
  return {
    calls: counter(body, 'amap_calls_total'),
    timeouts: counter(body, 'amap_timeouts_total'),
    errors: counter(body, 'amap_errors_total'),
    upstream: counter(body, 'amap_upstream_errors_total'),
  }
}
const savePlace = (app: Awaited<ReturnType<typeof setup>>['app'], h: Record<string, string>) =>
  app.inject({ method: 'PUT', url: '/api/places/home', headers: h, payload: { address: '北京市朝阳区某路' } })

describe('高德调用可观测性指标进 /metrics', () => {
  afterEach(() => { vi.unstubAllGlobals(); delete process.env.AMAP_API_KEY; delete process.env.AMAP_TIMEOUT_MS })

  it('四个 amap 计数从启动即以 0 基线存在（Prometheus rate() 不断档）', async () => {
    const { app } = await setup()
    const c = await amapCounters(app)
    expect(c).toEqual({ calls: 0, timeouts: 0, errors: 0, upstream: 0 })
    await app.close()
  })

  it('成功调用：amap_calls_total +1，其余不动', async () => {
    process.env.AMAP_API_KEY = 'webkey'
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200,
      json: async () => ({ status: '1', infocode: '10000', geocodes: [{ location: '116.4137,39.9056' }] }) })))
    const { app, h } = await setup()
    expect((await savePlace(app, h)).statusCode).toBe(200)
    const c = await amapCounters(app)
    expect(c).toEqual({ calls: 1, timeouts: 0, errors: 0, upstream: 0 })
    await app.close()
  })

  it('上游错误的**原因**进 admin 总览 amap.lastError（运维一眼知 key 配错须「Web服务」类型，不必翻日志）', async () => {
    process.env.AMAP_API_KEY = 'webkey'
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200,
      json: async () => ({ status: '0', info: 'USERKEY_PLAT_NOMATCH', infocode: '10009' }) })))
    const store = new MemoryStore()
    store.createUser({ id: 'a1', username: 'root', passwordHash: hashPassword('rootpass1'), displayName: 'root', role: 'admin', status: 'active', createdAt: Date.now() })
    const app = buildApp(store)
    const adminTok = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'root', password: 'rootpass1' } })).json().token as string
    const blindTok = (await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'blind1', password: 'secret123', role: 'blind' } })).json().token as string
    const ah = { authorization: `Bearer ${adminTok}` }
    // 初始：无上游错误、无原因。
    const ov0 = (await app.inject({ method: 'GET', url: '/api/admin/overview', headers: ah })).json()
    expect(ov0.amap.upstreamErrors).toBe(0)
    expect(ov0.amap.lastError).toBeNull()
    // 触发一次 best-effort geocode（撞 USERKEY_PLAT_NOMATCH）——route 吞错，但计数/便签在 assertAmapOk 内已置。
    await app.inject({ method: 'PUT', url: '/api/places/home', headers: { authorization: `Bearer ${blindTok}` }, payload: { address: '北京市朝阳区某路' } })
    const ov1 = (await app.inject({ method: 'GET', url: '/api/admin/overview', headers: ah })).json()
    expect(ov1.amap.upstreamErrors).toBe(1)
    expect(ov1.amap.lastError).toContain('USERKEY_PLAT_NOMATCH')   // 原因回带到面板
    expect(typeof ov1.amap.lastErrorAt).toBe('number')
    await app.close()
  })

  it('上游错误(status!=1，如 key 平台不符)：amap_calls_total +1 且 amap_upstream_errors_total +1', async () => {
    process.env.AMAP_API_KEY = 'webkey'
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200,
      json: async () => ({ status: '0', info: 'USERKEY_PLAT_NOMATCH', infocode: '10009' }) })))
    const { app, h } = await setup()
    expect((await savePlace(app, h)).statusCode).toBe(200) // geocode best-effort，吞错照存
    const c = await amapCounters(app)
    expect(c.calls).toBe(1)
    expect(c.upstream).toBe(1)
    expect(c.timeouts).toBe(0)
    await app.close()
  })

  it('纯网络瞬断：重试一次 → amap_calls_total=2 且 amap_errors_total=2（超时不重试的对照）', async () => {
    process.env.AMAP_API_KEY = 'webkey'
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('fetch failed') }))
    const { app, h } = await setup()
    expect((await savePlace(app, h)).statusCode).toBe(200)
    const c = await amapCounters(app)
    expect(c.calls).toBe(2) // 首次 + 重试各计一次实际 fetch
    expect(c.errors).toBe(2)
    expect(c.timeouts).toBe(0)
    expect(c.upstream).toBe(0)
    await app.close()
  })

  it('我方硬超时(abort)：amap_timeouts_total +1 且不重试(calls=1)', async () => {
    process.env.AMAP_API_KEY = 'webkey'
    process.env.AMAP_TIMEOUT_MS = '5' // 极短超时逼出 abort
    // 挂起的 fetch：只在收到 abort 信号时 reject（模拟高德慢/挂）。
    vi.stubGlobal('fetch', vi.fn((_url: string, opts?: { signal?: AbortSignal }) => new Promise((_res, rej) => {
      opts?.signal?.addEventListener('abort', () => rej(new DOMException('The operation was aborted.', 'AbortError')))
    })))
    const { app, h } = await setup()
    expect((await savePlace(app, h)).statusCode).toBe(200)
    const c = await amapCounters(app)
    expect(c.timeouts).toBe(1)
    expect(c.calls).toBe(1) // 超时不重试：只有一次实际 fetch
    expect(c.errors).toBe(0)
    await app.close()
  })
})
