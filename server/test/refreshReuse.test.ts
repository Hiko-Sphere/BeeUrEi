import { describe, it, expect, afterEach } from 'vitest'
import { buildApp } from '../src/app'
import { MemoryStore } from '../src/db/store'
import { SqliteStore } from '../src/db/sqliteStore'

// refresh token 轮换 + 重放检测（OWASP）：被轮换的旧 token 超宽限窗再现 = 被窃信号 → 吊销整个会话族。
describe('refresh 重放检测', () => {
  afterEach(() => { delete process.env.REFRESH_REUSE_GRACE_MS })

  async function seed() {
    const a = buildApp(new MemoryStore())
    const reg = await a.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'reuser1', password: 'secret123', role: 'helper' } })
    const { token, refreshToken } = reg.json()
    return { a, token, refreshToken }
  }
  const refresh = (a: any, rt: string) => a.inject({ method: 'POST', url: '/api/auth/refresh', payload: { refreshToken: rt } })
  const me = (a: any, t: string) => a.inject({ method: 'GET', url: '/api/me', headers: { authorization: `Bearer ${t}` } })

  it('正常轮换：新对可用；宽限窗内重放旧 token 仍放行（弱网丢响应的合法重试）', async () => {
    const { a, refreshToken } = await seed() // 默认宽限 30s
    const r1 = await refresh(a, refreshToken)
    expect(r1.statusCode).toBe(200)
    // 立即用旧 token 重试（模拟响应丢失）：宽限窗内 → 放行，仍能换出可用的一对。
    const r2 = await refresh(a, refreshToken)
    expect(r2.statusCode).toBe(200)
    expect((await me(a, r2.json().token)).statusCode).toBe(200)
    await a.close()
  })

  it('超宽限窗重放：401 且整个会话族被吊销（新 refresh 与 access 全部失效）；错误码与普通失效相同（无 oracle）', async () => {
    process.env.REFRESH_REUSE_GRACE_MS = '0' // 严格模式：任何重放立即吊销
    const { a, refreshToken } = await seed()
    const r1 = await refresh(a, refreshToken)
    expect(r1.statusCode).toBe(200)
    const { token: newAccess, refreshToken: newRefresh } = r1.json()
    expect((await me(a, newAccess)).statusCode).toBe(200) // 吊销前：新 access 可用
    // 攻击者（或本人）重放已轮换的旧 token → 401，且吊销会话族。
    const replay = await refresh(a, refreshToken)
    expect(replay.statusCode).toBe(401)
    expect(replay.json()).toMatchObject({ error: 'invalid_refresh_token' }) // 与普通失效同码，不给"已识破"信号
    // 会话族死透：先前换出的新 refresh 也 401；新 access 因 hasActiveSession 失败即刻失效。
    expect((await refresh(a, newRefresh)).statusCode).toBe(401)
    expect((await me(a, newAccess)).statusCode).toBe(401)
    await a.close()
  })

  it('重放只吊销本会话族，不伤同用户其他设备的会话', async () => {
    process.env.REFRESH_REUSE_GRACE_MS = '0'
    const a = buildApp(new MemoryStore())
    await a.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'reuser2', password: 'secret123', role: 'helper' } })
    const s1 = (await a.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'reuser2', password: 'secret123' } })).json() // 设备A
    const s2 = (await a.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'reuser2', password: 'secret123' } })).json() // 设备B
    await refresh(a, s1.refreshToken)          // 设备A 轮换
    await refresh(a, s1.refreshToken)          // 设备A 旧 token 重放 → 吊销 A 会话族
    expect((await me(a, s2.token)).statusCode).toBe(200)          // 设备B access 不受伤
    expect((await refresh(a, s2.refreshToken)).statusCode).toBe(200) // 设备B refresh 不受伤
    await a.close()
  })

  it('登出后墓碑不撑会话：hasActiveSession 排除已轮换 token（access 立即失效）', async () => {
    const { a, refreshToken } = await seed()
    const r1 = await refresh(a, refreshToken) // 产生墓碑(旧) + 活跃(新)
    const { token: access, refreshToken: current } = r1.json()
    await a.inject({ method: 'POST', url: '/api/auth/logout', payload: { refreshToken: current } }) // 删活跃 token
    // 墓碑仍在（宽限窗内未清），但绝不能撑着会话让 access 继续有效。
    expect((await me(a, access)).statusCode).toBe(401)
    await a.close()
  })

  it('过期清扫（双存储）：连墓碑一起删', () => {
    const now = 1_700_000_000_000
    for (const store of [new MemoryStore(), new SqliteStore(':memory:')]) {
      store.createRefreshToken({ tokenHash: 'h1', userId: 'u', expiresAt: now - 1 })                    // 过期
      store.createRefreshToken({ tokenHash: 'h2', userId: 'u', expiresAt: now - 1, rotatedAt: now - 5 }) // 过期墓碑
      store.createRefreshToken({ tokenHash: 'h3', userId: 'u', expiresAt: now + 1000 })                  // 活跃
      expect(store.deleteExpiredRefreshTokens(now)).toBe(2)
      expect(store.findRefreshToken('h3')).toBeDefined()
      expect(store.deleteExpiredRefreshTokens(now)).toBe(0) // 幂等
    }
  })
})
