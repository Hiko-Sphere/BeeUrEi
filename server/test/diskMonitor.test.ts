import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { diskUsage, isDiskLow, dataDir, DISK_LOW_ABS_BYTES } from '../src/monitoring/disk'
import { buildApp } from '../src/app'
import { MemoryStore } from '../src/db/store'
import { hashPassword } from '../src/auth/passwords'

/// 磁盘余量监控（防"慢性死亡"：磁盘满→sqlite 写失败整站瘫——自托管头号隐性故障，
/// 本机曾囤 455 镜像+8.5GB 构建缓存逼近此境）。低水位=剩余 <10% 或 <2GiB。
const GiB = 1024 ** 3

describe('isDiskLow 低水位判定（纯逻辑）', () => {
  it('比例线：<10% 告警、≥10% 不告警（大盘场景，绝对底线已越过）', () => {
    expect(isDiskLow({ freeBytes: 9 * GiB, totalBytes: 100 * GiB })).toBe(true)   // 9% → 告警
    expect(isDiskLow({ freeBytes: 10 * GiB, totalBytes: 100 * GiB })).toBe(false) // 恰 10% → 不告警
    expect(isDiskLow({ freeBytes: 50 * GiB, totalBytes: 100 * GiB })).toBe(false)
  })

  it('绝对底线：小盘 10% 以上但 <2GiB 也告警（20GB 盘剩 1.9GB 已经很紧）', () => {
    expect(isDiskLow({ freeBytes: 1.9 * GiB, totalBytes: 16 * GiB })).toBe(true)  // 11.9% 但 <2GiB
    expect(isDiskLow({ freeBytes: 2.1 * GiB, totalBytes: 16 * GiB })).toBe(false) // 13% 且 >2GiB
    expect(DISK_LOW_ABS_BYTES).toBe(2 * GiB)
  })

  it('异常输入（total<=0）宁缺毋滥：不告警', () => {
    expect(isDiskLow({ freeBytes: 0, totalBytes: 0 })).toBe(false)
  })

  it('diskUsage 真 statfs：本机数据目录可量出正余量且 free≤total；坏路径→null（诚实缺席）', () => {
    const u = diskUsage(dataDir())
    expect(u).not.toBeNull()
    expect(u!.freeBytes).toBeGreaterThan(0)
    expect(u!.totalBytes).toBeGreaterThanOrEqual(u!.freeBytes)
    expect(diskUsage('/no/such/dir/for/beeurei-disk-test')).toBeNull()
  })
})

describe('磁盘余量在运维面（overview + /metrics）如实呈现', () => {
  it('admin overview 含 disk{freeBytes,totalBytes,low}，low 与纯逻辑口径一致', async () => {
    const store = new MemoryStore()
    // 公开注册不发 admin 角色（正确的边界）——直接种一个管理员再登录。
    store.createUser({ id: 'a1', username: 'dsk_root', passwordHash: hashPassword('rootpass1x'), displayName: 'root', role: 'admin', status: 'active', createdAt: Date.now() } as never)
    const app = buildApp(store)
    const login = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { username: 'dsk_root', password: 'rootpass1x' } })
    const r = await app.inject({ method: 'GET', url: '/api/admin/overview', headers: { authorization: `Bearer ${login.json().token}` } })
    expect(r.statusCode).toBe(200)
    const disk = r.json().disk
    expect(disk).not.toBeNull()
    expect(disk.freeBytes).toBeGreaterThan(0)
    expect(disk.totalBytes).toBeGreaterThanOrEqual(disk.freeBytes)
    expect(disk.low).toBe(isDiskLow(disk)) // 面板据 low 亮红卡——口径必须与纯逻辑同源
    // 备份新鲜度也在概览里（默认 BACKUP_KEEP_DAYS 启用 → 非 null；测试环境无备份目录 → stale=true，count=0）。
    const backup = r.json().backup
    expect(backup).not.toBeNull()
    expect(backup).toMatchObject({ count: expect.any(Number), stale: expect.any(Boolean) })
    await app.close()
  })

  it('/metrics 暴露 disk_free_bytes/disk_total_bytes gauge（Prometheus 可据此设告警规则）', async () => {
    const app = buildApp(new MemoryStore())
    const r = await app.inject({ method: 'GET', url: '/metrics' })
    expect(r.statusCode).toBe(200)
    expect(r.body).toMatch(/beeurei_disk_free_bytes \d+/)
    expect(r.body).toMatch(/beeurei_disk_total_bytes \d+/)
    await app.close()
  })

  it('/metrics 暴露 backup_count（默认启用）+ 有备份时 backup_age_seconds gauge（Prometheus 告警"备份超 26h"）', async () => {
    // 默认无备份目录 → count=0、无 age（诚实缺席，不编造 0 龄触发假"新鲜"）。
    const app1 = buildApp(new MemoryStore())
    const b1 = (await app1.inject({ method: 'GET', url: '/metrics' })).body
    expect(b1).toMatch(/beeurei_backup_count 0/)
    expect(b1).not.toMatch(/beeurei_backup_age_seconds/) // 无备份 → age gauge 缺席
    await app1.close()
    // 指向含一份备份的目录 → count=1 且 age gauge 露出（Prometheus 据此设"age > 93600 → page"）。
    const dir = mkdtempSync(join(tmpdir(), 'beeurei-mx-'))
    writeFileSync(join(dir, 'beeurei-20260712.db'), 'x')
    const prevDir = process.env.BACKUP_DIR
    process.env.BACKUP_DIR = dir
    try {
      const app2 = buildApp(new MemoryStore())
      const b2 = (await app2.inject({ method: 'GET', url: '/metrics' })).body
      expect(b2).toMatch(/beeurei_backup_count 1/)
      expect(b2).toMatch(/beeurei_backup_age_seconds \d+/)
      await app2.close()
    } finally {
      if (prevDir === undefined) delete process.env.BACKUP_DIR; else process.env.BACKUP_DIR = prevDir
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
