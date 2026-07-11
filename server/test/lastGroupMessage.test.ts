import { describe, it, expect } from 'vitest'
import { MemoryStore, type ChatMessage, type Store } from '../src/db/store'
import { SqliteStore } from '../src/db/sqliteStore'

// 群"最后一条"单取（会话列表预览）：两 store 必须一致，且与"groupMessages 拉全部再取末尾"等价
//（本改把 groupMessages(_,200)+末尾 换成 lastGroupMessage 单取，等价性是不能破的不变量）。
const gm = (id: string, groupId: string, createdAt: number, text = 'x'): ChatMessage =>
  ({ id, fromId: 'u1', toId: '', groupId, kind: 'text', text, createdAt } as ChatMessage)

const stores: [string, () => Store][] = [
  ['MemoryStore', () => new MemoryStore()],
  ['SqliteStore', () => new SqliteStore(':memory:')],
]

describe('lastGroupMessage 群最后一条', () => {
  for (const [label, make] of stores) {
    it(`${label}: 空群→undefined；有消息→(createdAt,id)最大者；与 groupMessages 末尾一致；不串群`, () => {
      const s = make()
      expect(s.lastGroupMessage('g1')).toBeUndefined() // 空群
      // 乱序插入；含同 createdAt 不同 id（id 决胜，与 byTimeThenId 升序末尾一致）。
      s.createMessage(gm('m2', 'g1', 100))
      s.createMessage(gm('m1', 'g1', 100)) // 同 createdAt=100，与 m2 平；升序末尾取 id 大者=m2
      s.createMessage(gm('m5', 'g1', 300)) // 最新
      s.createMessage(gm('m3', 'g1', 200))
      s.createMessage(gm('other', 'g2', 999)) // 别的群，绝不能被 g1 取到
      const last = s.lastGroupMessage('g1')
      expect(last?.id).toBe('m5') // createdAt 300 最大
      // 等价性：与 groupMessages 拉全部再取末尾完全相同（本次重构的正确性保证）。
      const all = s.groupMessages('g1', 1000)
      expect(last).toEqual(all[all.length - 1])
      // 不串群：g2 的最后一条是 other，不受 g1 影响。
      expect(s.lastGroupMessage('g2')?.id).toBe('other')
    })

    it(`${label}: 同 createdAt 时按 id 决胜（与 groupMessages 升序末尾同序）`, () => {
      const s = make()
      s.createMessage(gm('b', 'g1', 500))
      s.createMessage(gm('a', 'g1', 500))
      s.createMessage(gm('c', 'g1', 500))
      const all = s.groupMessages('g1', 1000)
      expect(s.lastGroupMessage('g1')?.id).toBe('c')       // 同 createdAt，id 最大=c
      expect(s.lastGroupMessage('g1')).toEqual(all[all.length - 1]) // 与末尾一致
    })
  }
})
