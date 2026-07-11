import { describe, it, expect } from 'vitest'
import { mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// 媒体文件落到独立临时目录（不污染仓库 data/），并可精确数磁盘文件。
process.env.MEDIA_DIR = mkdtempSync(join(tmpdir(), 'beeurei-media-rb-'))

import { buildApp } from '../src/app'
import { MemoryStore } from '../src/db/store'

// 上传媒体是 await 落盘 → createMedia 落库两步。若落库失败(better-sqlite3 在 SQLITE_BUSY/IOERR 同步抛)，
// 文件已落盘但无元数据行——orphanSweep 只遍历 media 表元数据、**扫不到裸文件** → 永久占盘。须上传时即回滚文件。
describe('媒体上传：元数据落库失败回滚磁盘文件（不留无元数据孤儿）', () => {
  it('createMedia 抛(SQLITE_BUSY)→删掉刚写的孤儿文件，MEDIA_DIR 不残留裸文件、无元数据行', async () => {
    class ThrowingCreateStore extends MemoryStore {
      createMedia(): void { throw new Error('SQLITE_BUSY: database is locked') }
    }
    const store = new ThrowingCreateStore()
    const app = buildApp(store)
    const u = (await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'mrb', password: 'secret123', role: 'blind' } })).json()
    const dir = process.env.MEDIA_DIR!
    const before = readdirSync(dir).length

    const up = await app.inject({ method: 'POST', url: '/api/media',
      headers: { authorization: `Bearer ${u.token}`, 'content-type': 'video/mp4' }, payload: Buffer.from('orphan-bytes-0123456789') })
    expect(up.statusCode).toBe(500) // createMedia 抛 → 500（不落 201）

    // 关键：磁盘不残留无元数据的孤儿文件（回滚生效），也没有元数据行。
    expect(readdirSync(dir).length).toBe(before)
    expect(store.allMedia()).toHaveLength(0)
    await app.close()
  })

  it('正常上传仍照落文件+元数据（回滚不误伤成功路径）', async () => {
    const store = new MemoryStore()
    const app = buildApp(store)
    const u = (await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'mrb2', password: 'secret123', role: 'blind' } })).json()
    const up = await app.inject({ method: 'POST', url: '/api/media',
      headers: { authorization: `Bearer ${u.token}`, 'content-type': 'video/mp4' }, payload: Buffer.from('good-bytes') })
    expect(up.statusCode).toBe(201)
    expect(store.allMedia()).toHaveLength(1)
    await app.close()
  })
})
