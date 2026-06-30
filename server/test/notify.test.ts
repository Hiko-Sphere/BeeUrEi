import { describe, it, expect } from 'vitest'
import { MemoryStore } from '../src/db/store'
import { notifyUser } from '../src/notifications/notify'
import type { PushSender } from '../src/push/apns'

class FakePush implements PushSender {
  sent: { token: string; title: string; body: string; extra?: Record<string, string>; threadId?: string; badge?: number }[] = []
  async sendCallInvite(): Promise<void> {}
  async sendAlert(token: string, title: string, body: string, extra?: Record<string, string>, threadId?: string, badge?: number): Promise<void> {
    this.sent.push({ token, title, body, extra, threadId, badge })
  }
}

function user(id: string, apnsToken?: string) {
  return { id, username: id, passwordHash: 'h', displayName: id, role: 'helper', status: 'active', createdAt: 1, apnsToken }
}

describe('notifyUser', () => {
  it('持久化通知 + best-effort 推送携带 badge=该用户未读总数（含本条）', () => {
    const store = new MemoryStore()
    store.createUser(user('u1', 't'.repeat(64)) as any)
    const push = new FakePush()

    notifyUser(store, push, 'u1', 'report_resolved', '标题', '正文', { reportId: 'r1' })
    // 写入通知表（权威、可回看）。
    expect(store.notificationsForUser('u1').length).toBe(1)
    expect(store.unreadNotificationCount('u1')).toBe(1)
    // 推送带 badge=1（含刚写入的这条），extra 平铺 kind+data。
    expect(push.sent).toHaveLength(1)
    expect(push.sent[0].badge).toBe(1)
    expect(push.sent[0].extra).toMatchObject({ kind: 'report_resolved', reportId: 'r1' })

    // 再来一条 → badge 递增到 2。
    notifyUser(store, push, 'u1', 'kyc_verified', '已实名', '通过', { status: 'verified' })
    expect(push.sent[1].badge).toBe(2)
  })

  it('无 apnsToken 不推送但仍持久化；用户不存在静默跳过', () => {
    const store = new MemoryStore()
    store.createUser(user('u2') as any) // 无 token
    const push = new FakePush()
    notifyUser(store, push, 'u2', 'kyc_rejected', 't', 'b')
    expect(store.notificationsForUser('u2').length).toBe(1)
    expect(push.sent).toHaveLength(0)
    notifyUser(store, push, 'ghost', 'x', 't', 'b') // 不存在
    expect(push.sent).toHaveLength(0)
  })
})
