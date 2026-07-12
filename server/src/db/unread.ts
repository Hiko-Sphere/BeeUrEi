import type { Store } from './store'

/// 用户未读总数（单聊 + 群聊 + 铃铛通知）——供未读汇总端点、聊天推送与通知推送的 App 图标角标共用。
/// 群未读口径与 GET /api/groups 一致（createdAt>已读时刻、非己发、非撤回）。
/// 放在中立的 db 层，避免上层（notify / routes）相互依赖。
export function totalUnreadFor(store: Store, userId: string): { messages: number; notifications: number; missedCalls: number; total: number } {
  // 静音会话**不计入全局角标**（WhatsApp/Telegram/Slack 同口径）：静音=用户明示"这个会话别再要我注意"，
  // 若被静音的热闹群持续把标签页/PWA/APNs 角标顶在 (37)，角标便失去"有事找我"的信号价值。
  // 会话列表行内的未读数照显（conversations/groups 端点不经此函数）；来电/紧急/铃铛通知走独立通道，不受静音影响。
  let messages = 0
  for (const m of store.latestMessagesPerPeer(userId)) {
    const peer = m.fromId === userId ? m.toId : m.fromId
    if (store.isDmMuted(userId, peer)) continue
    messages += store.unreadCount(userId, peer)
  }
  for (const g of store.groupsFor(userId)) {
    if (store.isGroupMuted(g.id, userId)) continue
    messages += store.unreadGroupCount(g.id, userId) // 无上限精确计数（旧法取最近 200 条 filter：>200 未读会封顶漏计、且每次载 200 条消息体）
  }
  const notifications = store.unreadNotificationCount(userId)
  // 未看的未接来电（我作为被叫、晚于上次查看通话记录的 missed）：并入总角标，与手机通话 App 一致——
  // 盲人离开手机后回来，从 App 图标/导航角标就知道"有人来过电话"，不必主动去翻通话记录。打开通话记录即清。
  const missedCalls = store.missedCallCountForUser(userId, store.findById(userId)?.callHistorySeenAt ?? 0)
  return { messages, notifications, missedCalls, total: messages + notifications + missedCalls }
}
