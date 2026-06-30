import type { Store } from '../db/store'
import { removeMediaFile } from './storage'

/// 孤儿媒体清扫（纯逻辑+磁盘副作用，可单测）：删除既无视频消息、也无录制引用、且已超过宽限期的媒体文件+元数据。
///
/// 安全设计（这是会删用户聊天视频/录制源文件的后台作业，故格外保守）：
/// - 引用集 = referencedMediaIds()：当前媒体唯一的两类引用方——视频消息(kind=video, text=mediaId) 与录制(mediaId)。
///   已核实 createMedia 仅由 /api/media 上传端点调用、mediaId 仅被这两类引用（若日后新增引用方，必须同步更新此集合）。
/// - 7 天宽限期（默认）：远超"上传→发送"窗口(秒级)，确保刚上传未及关联的媒体绝不被误删。
/// - 只删 createdAt 早于 (now - graceMs) 且不在引用集中的媒体。
export function sweepOrphanMedia(store: Store, now: number, graceMs = 7 * 24 * 60 * 60 * 1000): number {
  const referenced = store.referencedMediaIds()
  let purged = 0
  for (const m of store.allMedia()) {
    if (now - m.createdAt < graceMs) continue // 宽限期内（含刚上传未发送的）一律不动
    if (referenced.has(m.id)) continue        // 仍被视频消息/录制引用 → 保留
    removeMediaFile(m.id)
    store.deleteMedia(m.id)
    purged++
  }
  return purged
}
