import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, writeFileSync, readdirSync, readFileSync, rmSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { MemoryStore } from '../src/db/store'
import { SqliteStore } from '../src/db/sqliteStore'
import { runAutoBackup, backupKeepDays, DEFAULT_BACKUP_KEEP_DAYS, defaultBackupDir } from '../src/backup/autoBackup'

// 每日自动备份 + 轮换：快照真实可恢复、按天去重、只清自己命名的文件、显式 0 关闭。
describe('自动备份', () => {
  const dirs: string[] = []
  const mkdir = () => { const d = mkdtempSync(join(tmpdir(), 'beeurei-ab-')); dirs.push(d); return d }
  afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })

  // 2026-07-03 12:00 本地时间
  const NOW = new Date(2026, 6, 3, 12).getTime()
  const DAY = 86_400_000

  function liveStore(dir: string): SqliteStore {
    const s = new SqliteStore(join(dir, 'live.db'))
    s.createUser({ id: 'u1', username: 'bk', passwordHash: 'h', displayName: 'bk', role: 'blind', status: 'active', createdAt: 1 })
    return s
  }

  it('落一份当日快照（真 SQLite 头 + 可重开查到数据）；同日重跑不重复', () => {
    const dir = mkdir(), bdir = join(dir, 'backups')
    const store = liveStore(dir)
    const r1 = runAutoBackup(store, NOW, bdir, 7)
    expect(r1.created).toBe(true)
    const files = readdirSync(bdir)
    expect(files).toEqual(['beeurei-20260703.db'])
    const body = readFileSync(join(bdir, files[0]))
    expect(body.subarray(0, 15).toString()).toBe('SQLite format 3') // 真快照
    expect(new SqliteStore(join(bdir, files[0])).findByUsername('bk')?.id).toBe('u1') // 可恢复
    // 同日再跑：不重复创建（幂等，每小时 sweep 调用友好）。
    expect(runAutoBackup(store, NOW + 3600_000, bdir, 7).created).toBe(false)
    expect(readdirSync(bdir).length).toBe(1)
  })

  it('轮换：超保留期的旧备份被清，窗内保留；目录里运营者的其他文件一概不碰', () => {
    const dir = mkdir(), bdir = join(dir, 'backups')
    const store = liveStore(dir)
    runAutoBackup(store, NOW - 3 * DAY, bdir, 7)   // 3 天前的备份（窗内）
    // 手工种"10 天前"的旧备份与外来文件（不经 runAutoBackup——它每次都会顺带轮换）。
    writeFileSync(join(bdir, 'beeurei-20260623.db'), 'old backup')
    writeFileSync(join(bdir, 'operator-notes.txt'), 'keep me') // 外来文件
    writeFileSync(join(bdir, 'manual-copy.db'), 'keep me too') // 非本工具命名
    const r = runAutoBackup(store, NOW, bdir, 7)
    expect(r.created).toBe(true)
    expect(r.purged).toBe(1) // 只清 10 天前那份
    const names = readdirSync(bdir).sort()
    expect(names).toContain('beeurei-20260703.db')
    expect(names).toContain('beeurei-20260630.db')      // 3 天前：窗内保留
    expect(names).toContain('operator-notes.txt')       // 外来文件不碰
    expect(names).toContain('manual-copy.db')
    expect(names).not.toContain('beeurei-20260623.db')  // 10 天前：已清
  })

  it('显式 BACKUP_KEEP_DAYS=0 关闭：不创建也不清理；内存存储无快照能力跳过', () => {
    const dir = mkdir(), bdir = join(dir, 'backups')
    const store = liveStore(dir)
    expect(runAutoBackup(store, NOW, bdir, 0)).toEqual({ created: false, purged: 0 })
    expect(existsSync(bdir)).toBe(false) // 关掉连目录都不建
    expect(runAutoBackup(new MemoryStore(), NOW, bdir, 7)).toEqual({ created: false, purged: 0 })
  })

  it('backupKeepDays env 解析：合法生效/0=关/坏值缺失回落 7/小数取整', () => {
    expect(backupKeepDays('14')).toBe(14)
    expect(backupKeepDays('0')).toBe(0)
    expect(backupKeepDays(undefined)).toBe(DEFAULT_BACKUP_KEEP_DAYS)
    expect(backupKeepDays('abc')).toBe(DEFAULT_BACKUP_KEEP_DAYS)
    expect(backupKeepDays('-3')).toBe(DEFAULT_BACKUP_KEEP_DAYS)
    expect(backupKeepDays('2.9')).toBe(2)
  })

  it('defaultBackupDir 跟随 DB 所在目录', () => {
    expect(defaultBackupDir('/srv/data/beeurei.db')).toBe('/srv/data/backups')
  })
})
