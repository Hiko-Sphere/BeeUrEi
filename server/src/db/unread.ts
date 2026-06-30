import type { Store } from './store'

/// 用户未读总数（单聊 + 群聊 + 铃铛通知）——供未读汇总端点、聊天推送与通知推送的 App 图标角标共用。
/// 群未读口径与 GET /api/groups 一致（createdAt>已读时刻、非己发、非撤回）。
/// 放在中立的 db 层，避免上层（notify / routes）相互依赖。
export function totalUnreadFor(store: Store, userId: string): { messages: number; notifications: number; total: number } {
  let messages = 0
  for (const m of store.latestMessagesPerPeer(userId)) {
    messages += store.unreadCount(userId, m.fromId === userId ? m.toId : m.fromId)
  }
  for (const g of store.groupsFor(userId)) {
    const readAt = store.groupReadAt(g.id, userId)
    messages += store.groupMessages(g.id, 200).filter((m) => m.createdAt > readAt && m.fromId !== userId && m.kind !== 'recalled').length
  }
  const notifications = store.unreadNotificationCount(userId)
  return { messages, notifications, total: messages + notifications }
}
