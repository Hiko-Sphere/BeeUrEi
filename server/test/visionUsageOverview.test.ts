import { describe, it, expect, afterEach, vi } from 'vitest'
import { buildApp } from '../src/app'
import { MemoryStore, type Store, type User } from '../src/db/store'
import { SqliteStore } from '../src/db/sqliteStore'
import { hashPassword } from '../src/auth/passwords'

const TINY_JPEG_B64 = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAEBAQ=='

// AI 视觉描述是**付费**功能（每次成功=一次外部付费调用）；admin 概览需暴露当日总用量供成本/滥用监控。
// 两存储口径必须一致（生产 Sqlite），否则运维在面板看到的用量与实际付费不符。

describe('totalVisionCallsOnDay（两存储聚合口径一致）', () => {
  for (const [name, make] of [['MemoryStore', () => new MemoryStore()], ['SqliteStore', () => new SqliteStore(':memory:')]] as const) {
    it(`${name}：跨用户聚合当日总数；跨日不计`, () => {
      const s: Store = make()
      const day = '2026-07-13', other = '2026-07-12'
      s.recordVisionCall('u1', day); s.recordVisionCall('u1', day) // u1: 2 次
      s.recordVisionCall('u2', day)                                // u2: 1 次
      s.recordVisionCall('u3', other)                              // u3: 另一天
      expect(s.totalVisionCallsOnDay(day)).toBe(3)   // u1(2)+u2(1)，u3 不同日不计
      expect(s.totalVisionCallsOnDay(other)).toBe(1) // 只 u3
      expect(s.totalVisionCallsOnDay('2026-01-01')).toBe(0) // 无记录
    })
  }
})

describe('admin 总览 vision（AI 视觉用量可观测）', () => {
  it('overview.vision.today 反映全体当日成功视觉调用总数（跨用户聚合）；初始 0', async () => {
    const store = new MemoryStore()
    const admin: User = { id: 'a1', username: 'root', passwordHash: hashPassword('rootpass1'), displayName: 'root', role: 'admin', status: 'active', createdAt: Date.now() }
    store.createUser(admin)
    const app = buildApp(store)
    const adminTok = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'root', password: 'rootpass1' } })).json().token as string

    const ov0 = (await app.inject({ method: 'GET', url: '/api/admin/overview', headers: { authorization: `Bearer ${adminTok}` } })).json()
    expect(ov0.vision.today).toBe(0)
    expect(ov0.vision.dailyMaxPerUser).toBeGreaterThan(0)
    expect(ov0.vision.quotaExceeded).toBe(0) // 撞配额累计（surfaced 供运维判断配额是否过紧）——初始 0

    // 记录跨两个用户的当日调用（直接 store，绕过端点的 VISION_* 配置/配额/图片）。
    const day = new Date().toISOString().slice(0, 10) // 与 overview 的 dayKey(now) 同 UTC 口径
    store.recordVisionCall('u1', day); store.recordVisionCall('u1', day); store.recordVisionCall('u2', day)

    const ov1 = (await app.inject({ method: 'GET', url: '/api/admin/overview', headers: { authorization: `Bearer ${adminTok}` } })).json()
    expect(ov1.vision.today).toBe(3) // 2(u1)+1(u2)
    await app.close()
  })

  it('overview.vision.quotaExceeded 随用户撞每日上限累计——运维据此判断配额是否过紧（闭环 visionDailyMax 可调）', async () => {
    process.env.VISION_API_KEY = 'k'; process.env.VISION_API_BASE = 'https://v.example.com/v1'; process.env.VISION_MODEL = 'm'
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'ok' } }] }) })))
    const store = new MemoryStore()
    store.createUser({ id: 'a1', username: 'root', passwordHash: hashPassword('rootpass1'), displayName: 'root', role: 'admin', status: 'active', createdAt: Date.now() })
    store.setAppConfig({ visionDailyMax: 1 }) // 配额压到 1，便于撞上限
    const app = buildApp(store)
    const adminTok = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'root', password: 'rootpass1' } })).json().token as string
    const u = (await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'blind1', password: 'secret123', role: 'blind' } })).json().token as string
    const call = () => app.inject({ method: 'POST', url: '/api/vision/describe', headers: { authorization: `Bearer ${u}` }, payload: { image: TINY_JPEG_B64, mime: 'image/jpeg' } })
    expect((await call()).statusCode).toBe(200) // 第 1 次成功
    expect((await call()).statusCode).toBe(429)  // 第 2 次撞配额 → metrics.inc(vision_quota_exceeded_total)
    const ov = (await app.inject({ method: 'GET', url: '/api/admin/overview', headers: { authorization: `Bearer ${adminTok}` } })).json()
    expect(ov.vision.quotaExceeded).toBe(1) // 概览如实反映撞配额次数
    await app.close()
  })

  afterEach(() => { vi.unstubAllGlobals(); delete process.env.VISION_API_KEY; delete process.env.VISION_API_BASE; delete process.env.VISION_MODEL })
})

describe('admin 用户详情 vision（付费用量可归因到人）', () => {
  it('users/:id.vision.today 只反映**该用户**当日调用量，不是全体总数', async () => {
    const store = new MemoryStore()
    const admin: User = { id: 'a1', username: 'root', passwordHash: hashPassword('rootpass1'), displayName: 'root', role: 'admin', status: 'active', createdAt: Date.now() }
    const target: User = { id: 'blind1', username: 'blind1', passwordHash: hashPassword('blindpass1'), displayName: '小明', role: 'blind', status: 'active', createdAt: Date.now() }
    store.createUser(admin); store.createUser(target)
    const app = buildApp(store)
    const adminTok = (await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'root', password: 'rootpass1' } })).json().token as string

    const day = new Date().toISOString().slice(0, 10) // 与详情端点 dayKey 同 UTC 口径
    // 目标用户 2 次；**另一**用户 5 次——若端点误用全体聚合(totalVisionCallsOnDay)，today 会是 7 而非 2。
    store.recordVisionCall('blind1', day); store.recordVisionCall('blind1', day)
    for (let i = 0; i < 5; i++) store.recordVisionCall('someone-else', day)

    const d = (await app.inject({ method: 'GET', url: '/api/admin/users/blind1', headers: { authorization: `Bearer ${adminTok}` } })).json()
    expect(d.vision.today).toBe(2)        // 只算 blind1 自己，不含 someone-else 的 5 次
    expect(d.vision.dailyMax).toBeGreaterThan(0)
    await app.close()
  })
})
