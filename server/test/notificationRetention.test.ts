import { describe, it, expect } from 'vitest'
import { MemoryStore, type Notification } from '../src/db/store'
import { SqliteStore } from '../src/db/sqliteStore'
import { sweepOldNotifications, notifRetentionDays, DEFAULT_NOTIF_RETENTION_DAYS } from '../src/notifications/retention'

const DAY = 86_400_000
function notif(id: string, userId: string, createdAt: number): Notification {
  return { id, userId, kind: 'friend_request', title: 't', body: 'b', createdAt }
}

describe('通知留存清扫（数据最小化）', () => {
  const now = 1_700_000_000_000

  for (const [name, make] of [
    ['MemoryStore', () => new MemoryStore()],
    ['SqliteStore', () => new SqliteStore(':memory:')],
  ] as const) {
    it(`${name}：删早于保留期的，留新的；已读未读一视同仁`, () => {
      const store = make()
      store.createNotification(notif('old', 'u1', now - 91 * DAY))                 // 过期
      store.createNotification({ ...notif('oldUnread', 'u2', now - 200 * DAY) })   // 过期且未读
      store.createNotification(notif('fresh', 'u1', now - 89 * DAY))               // 窗内
      store.createNotification(notif('today', 'u3', now))                          // 刚发生
      const purged = sweepOldNotifications(store, now, 90)
      expect(purged).toBe(2)
      expect(store.notificationsForUser('u1').map((n) => n.id)).toEqual(['fresh'])
      expect(store.notificationsForUser('u2')).toEqual([])
      expect(store.notificationsForUser('u3').map((n) => n.id)).toEqual(['today'])
      // 再清一次：无可清（幂等）。
      expect(sweepOldNotifications(store, now, 90)).toBe(0)
    })
  }

  it('恰在边界（= 保留期整）不删——cutoff 为严格早于', () => {
    const store = new MemoryStore()
    store.createNotification(notif('edge', 'u1', now - 90 * DAY)) // createdAt == cutoff
    expect(sweepOldNotifications(store, now, 90)).toBe(0)
    expect(store.notificationsForUser('u1').length).toBe(1)
  })

  it('NOTIF_RETENTION_DAYS 环境解析：合法值生效，坏值/缺失回落默认 90', () => {
    expect(notifRetentionDays('30')).toBe(30)
    expect(notifRetentionDays('1')).toBe(1)
    expect(notifRetentionDays(undefined)).toBe(DEFAULT_NOTIF_RETENTION_DAYS)
    expect(notifRetentionDays('abc')).toBe(DEFAULT_NOTIF_RETENTION_DAYS)
    expect(notifRetentionDays('0')).toBe(DEFAULT_NOTIF_RETENTION_DAYS)   // <1 非法：不许"立即清空一切"
    expect(notifRetentionDays('-5')).toBe(DEFAULT_NOTIF_RETENTION_DAYS)
    expect(notifRetentionDays('Infinity')).toBe(DEFAULT_NOTIF_RETENTION_DAYS)
  })
})
