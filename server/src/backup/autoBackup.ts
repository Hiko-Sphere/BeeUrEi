import { existsSync, mkdirSync, readdirSync, renameSync, unlinkSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { Store } from '../db/store'

/// 每日自动备份 + 轮换（自托管运维刚需）：管理面板的手动下载备份没人会天天点——数据库损坏/
/// 误操作/坏迁移时，唯一副本就没了。每天用 VACUUM INTO（复用 store.backupTo，一致性快照、
/// 在线不锁写）落一份到备份目录，保留最近 N 天。
///
/// 诚实边界：同盘备份**不防磁盘整体损坏**（那要靠运营者把备份目录再同步到异地——rsync/云盘均可），
/// 防的是更常见的库损坏/删错数据/迁移事故。内存/JSON 存储无 backupTo → 跳过（JSON 文件本身
/// 就是可拷贝的完整状态）。
///
/// 配置：BACKUP_DIR（默认 <DB所在目录>/backups）；BACKUP_KEEP_DAYS（默认 7，**显式 '0' = 关闭**
/// ——运营者可能有外部备份方案，这是合法意图；坏值/缺失回落默认）。
export const DEFAULT_BACKUP_KEEP_DAYS = 7

export function backupKeepDays(env: string | undefined = process.env.BACKUP_KEEP_DAYS): number {
  if (env?.trim() === '0') return 0 // 显式关闭
  const d = Number(env)
  return Number.isFinite(d) && d >= 1 ? Math.floor(d) : DEFAULT_BACKUP_KEEP_DAYS
}

export function defaultBackupDir(dbPath: string = process.env.DB_PATH ?? 'data/beeurei.db'): string {
  return process.env.BACKUP_DIR ?? join(dirname(dbPath), 'backups')
}

const NAME_RE = /^beeurei-(\d{4})(\d{2})(\d{2})\.db$/

/// 跑一轮自动备份（由每小时 sweep 调用；按天去重，一天只落一份）。
/// 返回 { created, purged }。任何失败抛给调用方记日志（sweep 已各自 try/catch，不互相阻断）。
export function runAutoBackup(store: Store, now: number,
                              dir: string = defaultBackupDir(),
                              keepDays: number = backupKeepDays()): { created: boolean; purged: number } {
  if (keepDays <= 0) return { created: false, purged: 0 }           // 显式关闭
  if (typeof store.backupTo !== 'function') return { created: false, purged: 0 } // 内存/JSON 存储：无快照能力，跳过

  const d = new Date(now)
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`
  const target = join(dir, `beeurei-${stamp}.db`)
  mkdirSync(dir, { recursive: true })

  let created = false
  if (!existsSync(target)) {
    // 先落临时文件再原子 rename：备份进行中崩溃绝不留半写的 .db 冒充完整备份。
    const tmp = `${target}.tmp`
    try {
      store.backupTo(tmp)
      renameSync(tmp, target)
      created = true
    } finally {
      try { unlinkSync(tmp) } catch { /* 已 rename 或未生成 */ }
    }
  }

  // 轮换：只清本工具命名的文件（beeurei-YYYYMMDD.db），目录里运营者放的其他东西一概不碰。
  let purged = 0
  const cutoff = now - keepDays * 86_400_000
  for (const name of readdirSync(dir)) {
    const m = NAME_RE.exec(name)
    if (!m) continue
    const fileAt = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime()
    if (fileAt < cutoff) {
      try { unlinkSync(join(dir, name)); purged++ } catch { /* 竞态/权限：下轮再试 */ }
    }
  }
  return { created, purged }
}
