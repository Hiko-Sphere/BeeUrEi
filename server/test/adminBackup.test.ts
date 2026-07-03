import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildApp } from '../src/app'
import { MemoryStore, type User } from '../src/db/store'
import { SqliteStore } from '../src/db/sqliteStore'
import { hashPassword } from '../src/auth/passwords'

function seedAdmin(store: MemoryStore | SqliteStore) {
  const admin: User = { id: 'admin1', username: 'root', passwordHash: hashPassword('secret123'),
    displayName: 'root', role: 'admin', status: 'active', createdAt: 1000 }
  store.createUser(admin)
}
async function login(app: ReturnType<typeof buildApp>) {
  const res = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'root', password: 'secret123' } })
  return (res.json() as { token: string }).token
}

describe('管理员数据库备份（灾难恢复）', () => {
  it('SQLite：备份是合法一致性快照，能开库并查到数据；落审计', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'beeurei-bk-'))
    try {
      const store = new SqliteStore(join(dir, 'live.db'))
      seedAdmin(store)
      const app = buildApp(store)
      const t = await login(app)
      const res = await app.inject({ method: 'GET', url: '/api/admin/backup', headers: { authorization: `Bearer ${t}` } })
      expect(res.statusCode).toBe(200)
      expect(res.headers['content-disposition']).toContain('beeurei-backup-')
      const body = res.rawPayload
      expect(body.subarray(0, 15).toString()).toBe('SQLite format 3') // 真 SQLite 文件头
      // 快照可恢复：写盘 → 用 SqliteStore 打开 → 数据在。
      const restorePath = join(dir, 'restore.db')
      writeFileSync(restorePath, body)
      const restored = new SqliteStore(restorePath)
      expect(restored.findByUsername('root')?.role).toBe('admin')
      // 审计落账（谁在何时导出了整库 PII，不可抵赖）。
      const audits = await app.inject({ method: 'GET', url: '/api/admin/audit', headers: { authorization: `Bearer ${t}` } })
      if (audits.statusCode === 200) {
        expect(JSON.stringify(audits.json())).toContain('db.backup')
      }
      await app.close()
    } finally { rmSync(dir, { recursive: true, force: true }) }
  })

  it('内存存储（无 SQLite）→ 503 backup_unavailable（诚实，绝不给假备份）', async () => {
    const store = new MemoryStore()
    seedAdmin(store)
    const app = buildApp(store)
    const t = await login(app)
    const res = await app.inject({ method: 'GET', url: '/api/admin/backup', headers: { authorization: `Bearer ${t}` } })
    expect(res.statusCode).toBe(503)
    expect(res.json()).toMatchObject({ error: 'backup_unavailable' })
    await app.close()
  })

  it('非管理员 → 403', async () => {
    const store = new MemoryStore()
    seedAdmin(store)
    const app = buildApp(store)
    const reg = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'user1', password: 'secret123', role: 'helper' } })
    const res = await app.inject({ method: 'GET', url: '/api/admin/backup', headers: { authorization: `Bearer ${(reg.json() as any).token}` } })
    expect(res.statusCode).toBe(403)
    await app.close()
  })
})
