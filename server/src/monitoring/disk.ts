import { statfsSync } from 'node:fs'
import { dirname } from 'node:path'

/// 磁盘余量监控（防"慢性死亡"：磁盘满 → sqlite 写失败 → 整站瘫，自托管最常见的隐性故障；
/// 本机曾囤 455 个镜像+8.5GB 构建缓存逼近此境）。零依赖：statfs 数据目录所在文件系统。
export interface DiskUsage {
  freeBytes: number
  totalBytes: number
}

/// 读取 path 所在文件系统的余量。statfs 不可用（异构 fs/权限）返回 null——监控探针失效
/// 不该拖垮业务端点，调用方按"无数据"呈现（诚实缺席，不编造 0 造成假警报）。
export function diskUsage(path: string): DiskUsage | null {
  try {
    const s = statfsSync(path)
    // bavail=非特权可用块（与 df 口径一致，扣除 root 保留），blocks=总块。
    return { freeBytes: s.bavail * s.bsize, totalBytes: s.blocks * s.bsize }
  } catch {
    return null
  }
}

// 低水位线：剩余 < 10% 或 < 2GiB 即告警（两者取更早触发的）。2GiB 底线护小盘机：
// 40GB 盘的 10% 是 4GB 尚可周旋，但 20GB 盘的 10%=2GB 已经很紧——绝对底线兜住。
export const DISK_LOW_RATIO = 0.1
export const DISK_LOW_ABS_BYTES = 2 * 1024 ** 3

/// 是否已到低水位（纯逻辑，可单测）。totalBytes<=0（异常输入）视为不告警——宁缺毋滥。
export function isDiskLow(u: DiskUsage): boolean {
  if (u.totalBytes <= 0) return false
  return u.freeBytes / u.totalBytes < DISK_LOW_RATIO || u.freeBytes < DISK_LOW_ABS_BYTES
}

/// 数据目录（DB/媒体/备份同卷）：磁盘监控量这里所在的文件系统。
export function dataDir(): string {
  return dirname(process.env.DB_PATH ?? 'data/beeurei.db')
}
