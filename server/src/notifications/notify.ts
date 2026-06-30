import { randomUUID } from 'node:crypto'
import type { Store } from '../db/store'
import type { PushSender } from '../push/apns'
import { totalUnreadFor } from '../db/unread'

/// 站内通知 + 离线推送的统一投递：
/// 先**持久化**到 notifications 表（权威、可回看、登录后必能看到），
/// 再**尽力**推送一条 APNs 横幅提醒（易丢/未配置 APNs 时为 Noop——绝不作为可靠投递来源）。
/// push 失败一律吞掉（best-effort），绝不影响调用方主流程或回滚已写入的通知。
export function notifyUser(
  store: Store,
  push: PushSender,
  userId: string,
  kind: string,
  title: string,
  body: string,
  data?: Record<string, string>,
): void {
  const user = store.findById(userId)
  if (!user) return // 用户可能已被删除（举报保留但账号已注销）——静默跳过
  // best-effort：通知写入失败绝不能 500 已提交的主操作（如封禁/处置已生效），故吞掉异常（见复审 NOTIFY-ISOLATE）。
  try {
    store.createNotification({ id: randomUUID(), userId, kind, title, body, data, createdAt: Date.now() })
  } catch { /* 通知不可作为主流程成功的前置条件 */ }
  if (user.apnsToken) {
    // badge=该用户未读总数（含刚写入的本条通知）：后台收到通知类推送时图标角标同样递增，
    // 与聊天推送一致（否则图标会漏计未读通知，见 App 图标角标主线）。
    const badge = totalUnreadFor(store, userId).total
    void push.sendAlert(user.apnsToken, title, body, { kind, ...(data ?? {}) }, undefined, badge).catch(() => { /* best-effort */ })
  }
}
