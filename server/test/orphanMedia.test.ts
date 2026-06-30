import { describe, it, expect } from 'vitest'
import { MemoryStore, type Store } from '../src/db/store'
import { SqliteStore } from '../src/db/sqliteStore'
import { sweepOrphanMedia } from '../src/media/orphanSweep'

// 两存储都测——孤儿清扫会删用户媒体源文件，MemoryStore 与 SqliteStore 的
// allMedia/referencedMediaIds 实现必须口径一致，否则生产(Sqlite)可能误删被引用媒体。
const DAY = 86_400_000

function seed(store: Store, now: number) {
  const old = now - 8 * DAY     // 超 7 天宽限
  const recent = now - 1 * DAY  // 宽限期内
  store.createMedia({ id: 'orphan-old', ownerId: 'u', mime: 'video/mp4', size: 1, createdAt: old })       // 孤儿+老 → 删
  store.createMedia({ id: 'orphan-recent', ownerId: 'u', mime: 'video/mp4', size: 1, createdAt: recent }) // 孤儿但近期 → 留
  store.createMedia({ id: 'msg-media', ownerId: 'u', mime: 'video/mp4', size: 1, createdAt: old })         // 被视频消息引用 → 留
  store.createMedia({ id: 'rec-media', ownerId: 'u', mime: 'video/mp4', size: 1, createdAt: old })         // 被录制引用 → 留
  store.createMessage({ id: 'm1', fromId: 'u', toId: 'v', kind: 'video', text: 'msg-media', createdAt: old })
  store.createRecording({ id: 'r1', callId: 'c', ownerId: 'u', consentBy: [], reason: '', recordedAt: old, mediaId: 'rec-media' })
}

describe('sweepOrphanMedia（两存储口径一致）', () => {
  for (const [name, make] of [['MemoryStore', () => new MemoryStore()], ['SqliteStore', () => new SqliteStore(':memory:')]] as const) {
    it(`${name}：删无引用且超 7 天的孤儿；保留被视频消息/录制引用的与近期上传的`, () => {
      const store = make()
      const now = 100 * DAY
      seed(store, now)
      const purged = sweepOrphanMedia(store, now)
      expect(purged).toBe(1)
      expect(store.findMedia('orphan-old')).toBeUndefined()  // 删
      expect(store.findMedia('orphan-recent')).toBeTruthy()  // 7 天宽限内保留（含刚上传未发送的）
      expect(store.findMedia('msg-media')).toBeTruthy()       // 视频消息引用 → 保留
      expect(store.findMedia('rec-media')).toBeTruthy()       // 录制引用 → 保留
    })
  }
})
