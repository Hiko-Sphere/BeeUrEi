import { describe, it, expect, afterEach } from 'vitest'
import { buildApp } from '../src/app'
import { MemoryStore } from '../src/db/store'
import { SqliteStore } from '../src/db/sqliteStore'
import { mediaQuotaBytes } from '../src/routes/media'

// 每用户媒体总量配额：限流只限速率不限存量，无配额则单账号可撑爆自托管磁盘。
describe('媒体总量配额', () => {
  afterEach(() => { delete process.env.MEDIA_QUOTA_MB })

  async function seed() {
    const store = new MemoryStore()
    const a = buildApp(store)
    const reg = (await a.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'quotau', password: 'secret123', role: 'blind' } })).json()
    return { a, store, token: reg.token as string, uid: reg.user.id as string }
  }
  const upload = (a: any, token: string, bytes: number) =>
    a.inject({ method: 'POST', url: '/api/media', headers: { authorization: `Bearer ${token}`, 'content-type': 'video/mp4' },
      payload: Buffer.alloc(bytes, 1) })

  it('配额内可传；超配额 413 media_quota_exceeded（与单文件过大错误码区分）', async () => {
    process.env.MEDIA_QUOTA_MB = '1' // 1MB 配额便于测试
    const { a, token } = await seed()
    expect((await upload(a, token, 600 * 1024)).statusCode).toBe(201)   // 600KB ok
    const over = await upload(a, token, 600 * 1024)                      // 再 600KB → 超 1MB
    expect(over.statusCode).toBe(413)
    expect(over.json()).toMatchObject({ error: 'media_quota_exceeded' }) // 不是 media_too_large
    await a.close()
  })

  it('并发上传越配额竞态防护：两个并发上传合计越配额 → 恰一个 413（reserve；旧实现两者都在提交前过检查→双双 201 越额）', async () => {
    process.env.MEDIA_QUOTA_MB = '1' // 1MB 配额
    const { a, store, token, uid } = await seed()
    // 各 0.6MB：单个都在 1MB 配额内，两个合计 1.2MB 越额。check+reserve 相邻同步 → 先跑者原子占额、后者检查即见占用被 413。
    const [r1, r2] = await Promise.all([upload(a, token, 600 * 1024), upload(a, token, 600 * 1024)])
    expect([r1.statusCode, r2.statusCode].sort()).toEqual([201, 413]) // 恰一成一拒；旧实现（record 在 await 后）会是 [201,201]
    expect(store.mediaBytesForOwner(uid)).toBe(600 * 1024)           // 只落库一条，未越额
    // 越额者被拒后预留已释放：删掉已传的那条 → 额度全清 → 可再传满配额。
    const okId = (r1.statusCode === 201 ? r1 : r2).json().media.id
    store.deleteMedia(okId)
    expect((await upload(a, token, 900 * 1024)).statusCode).toBe(201) // 预留未泄漏（否则此处会被幽灵占额挡下）
    await a.close()
  })

  it('删除媒体即时释放额度（清理旧内容后能继续上传）', async () => {
    process.env.MEDIA_QUOTA_MB = '1'
    const { a, store, token, uid } = await seed()
    const first = await upload(a, token, 600 * 1024)
    expect(first.statusCode).toBe(201)
    // 删掉这条媒体（等价于删消息/孤儿清扫的效果）→ 额度释放。
    store.deleteMedia(first.json().media.id)
    expect(store.mediaBytesForOwner(uid)).toBe(0)
    expect((await upload(a, token, 600 * 1024)).statusCode).toBe(201)
    await a.close()
  })

  it('配额只按本人算：他人用量不占我的额度', async () => {
    process.env.MEDIA_QUOTA_MB = '1'
    const { a, token } = await seed()
    const reg2 = (await a.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'quotav', password: 'secret123', role: 'blind' } })).json()
    expect((await upload(a, token, 700 * 1024)).statusCode).toBe(201)      // 用户1 占 700KB
    expect((await upload(a, reg2.token, 700 * 1024)).statusCode).toBe(201) // 用户2 不受影响
    await a.close()
  })

  it('mediaQuotaBytes env 解析：合法生效/坏值缺失回落 2GB/下限 1MB', () => {
    expect(mediaQuotaBytes('100')).toBe(100 * 1024 * 1024)
    expect(mediaQuotaBytes(undefined)).toBe(2048 * 1024 * 1024)
    expect(mediaQuotaBytes('abc')).toBe(2048 * 1024 * 1024)
    expect(mediaQuotaBytes('0')).toBe(2048 * 1024 * 1024)
    expect(mediaQuotaBytes('-5')).toBe(2048 * 1024 * 1024)
  })

  it('Sqlite mediaBytesForOwner：SUM 与逐条一致（空=0）', () => {
    const sq = new SqliteStore(':memory:')
    expect(sq.mediaBytesForOwner('u1')).toBe(0)
    sq.createMedia({ id: 'm1', ownerId: 'u1', mime: 'video/mp4', size: 1000, createdAt: 1 })
    sq.createMedia({ id: 'm2', ownerId: 'u1', mime: 'video/mp4', size: 234, createdAt: 2 })
    sq.createMedia({ id: 'm3', ownerId: 'u2', mime: 'video/mp4', size: 999, createdAt: 3 })
    expect(sq.mediaBytesForOwner('u1')).toBe(1234)
    sq.deleteMedia('m1')
    expect(sq.mediaBytesForOwner('u1')).toBe(234)
  })
})
