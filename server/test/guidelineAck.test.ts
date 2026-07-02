import { describe, it, expect } from 'vitest'
import { buildApp } from '../src/app'
import { MemoryStore } from '../src/db/store'
import { SqliteStore } from '../src/db/sqliteStore'

describe('协助者行为守则确认（guideline-ack）', () => {
  it('未确认时 selfView 为 null；确认后落时间戳；重复确认 keep-first 不刷新', async () => {
    const app = buildApp(new MemoryStore())
    const r = (await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'helper1', password: 'secret123', role: 'helper' } })).json()
    const h = { authorization: `Bearer ${r.token}` }

    // 初始：null → 客户端据此展示一次性守则卡
    const me0 = (await app.inject({ method: 'GET', url: '/api/me', headers: h })).json()
    expect(me0.user.helperGuidelineAckAt).toBeNull()

    const ack1 = await app.inject({ method: 'POST', url: '/api/assist/guideline-ack', headers: h })
    expect(ack1.statusCode).toBe(200)
    const at1 = ack1.json().helperGuidelineAckAt
    expect(typeof at1).toBe('number')

    // selfView 回传
    const me1 = (await app.inject({ method: 'GET', url: '/api/me', headers: h })).json()
    expect(me1.user.helperGuidelineAckAt).toBe(at1)

    // keep-first：重复确认返回首次时间戳（首次确认时刻是追责锚点）
    await new Promise((res) => setTimeout(res, 5))
    const ack2 = await app.inject({ method: 'POST', url: '/api/assist/guideline-ack', headers: h })
    expect(ack2.json().helperGuidelineAckAt).toBe(at1)

    await app.close()
  })

  it('未登录 401', async () => {
    const app = buildApp(new MemoryStore())
    const res = await app.inject({ method: 'POST', url: '/api/assist/guideline-ack' })
    expect(res.statusCode).toBe(401)
    await app.close()
  })

  it('SqliteStore 列往返 parity：helperGuidelineAckAt 持久化后读回一致', () => {
    const store = new SqliteStore(':memory:')
    store.createUser({ id: 'u1', username: 'h', passwordHash: 'x', displayName: 'H', role: 'helper', status: 'active', createdAt: 1 })
    expect(store.findById('u1')!.helperGuidelineAckAt).toBeUndefined()
    store.updateUser('u1', { helperGuidelineAckAt: 1234567890 })
    expect(store.findById('u1')!.helperGuidelineAckAt).toBe(1234567890)
  })
})
