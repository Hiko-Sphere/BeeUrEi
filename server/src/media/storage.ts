import { mkdirSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'

/// 媒体文件磁盘存储（视频消息等大文件）：实体文件在 MEDIA_DIR（默认 data/media，
/// 生产经 beeurei-data 卷持久化），元数据在 Store.media 表。自托管原则——不引入外部对象存储。

export function mediaDir(): string {
  return process.env.MEDIA_DIR?.trim() || 'data/media'
}

/// 文件路径以 UUID 为名（无扩展名；mime 在元数据里）。id 由服务端生成，不接受外部输入拼路径。
export function mediaPath(id: string): string {
  return join(mediaDir(), id)
}

export function ensureMediaDir(): void {
  mkdirSync(mediaDir(), { recursive: true })
}

export function mediaFileExists(id: string): boolean {
  return existsSync(mediaPath(id))
}

export function removeMediaFile(id: string): void {
  try { rmSync(mediaPath(id)) } catch { /* 文件不存在/已删——幂等 */ }
}
