import { randomUUID } from 'node:crypto'
import type { Store, User } from '../db/store'
import type { PushSender } from '../push/apns'
import { NoopWebPushSender, type WebPushSender } from '../push/webPush'
import { totalUnreadFor } from '../db/unread'
import { shouldSuppressPush } from './quietHours'
import { pushLang, pushStrings, type SecurityEvent } from '../push/pushStrings'

// Web Push 发送器（模块单例，buildApp 注入——与 auth/rbac 的 setAuthStore 同一先例）：
// notifyUser 有 11 个调用点分布 4 条注册链，穿参改动面大且易漏；统一投递本就该单点配置。
let webPushSender: WebPushSender = new NoopWebPushSender()
export function setNotifyWebPush(sender: WebPushSender): void { webPushSender = sender }

/// 站内通知 + 离线推送的统一投递：
/// 先**持久化**到 notifications 表（权威、可回看、登录后必能看到），
/// 再**尽力**推送 APNs 横幅 + Web Push 浏览器通知（未配置时各自为 Noop——绝不作为可靠投递来源）。
/// push 失败一律吞掉（best-effort），绝不影响调用方主流程或回滚已写入的通知。
/// 经由本函数的全部通知类别（好友请求/路线添加/举报处置/群变更…）自动获得双通道，与
/// 紧急告警/来电/聊天的手工扇出口径一致——web-only 用户不再漏任何一类实时提醒。
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
  // 勿扰时段：在收件人本地勿扰时段内**只抑制推送横幅**（软通知不半夜吵醒），站内通知已持久化、醒来照常可见。
  // 紧急告警/来电/SOS 走独立扇出、绝不经此；此处 isAlwaysThrough 再兜一层，防未来有紧急类误走本函数被静默。
  if (shouldSuppressPush(user.quietHours, kind, Date.now())) return
  // best-effort 推送：badge(totalUnreadFor) 与订阅(webPushSubscriptionsForUser) 都是**同步** store 读，
  // better-sqlite3 的 .all()/.get() 在 SQLITE_BUSY/IOERR 时会**同步抛**——绝不能让它 500 已提交的主操作
  // （封禁/举报处置/加好友/路线添加等早已生效）。写入(createNotification)上面已单独 try/catch，读这里补齐同款隔离
  // （见 SOS 扇出复审：写有兜底、读却漏了的同类不对称守卫缺口）。
  try {
    if (user.apnsToken) {
      // badge=该用户未读总数（含刚写入的本条通知）：后台收到通知类推送时图标角标同样递增，
      // 与聊天推送一致（否则图标会漏计未读通知，见 App 图标角标主线）。
      const badge = totalUnreadFor(store, userId).total
      void push.sendAlert(user.apnsToken, title, body, { kind, ...(data ?? {}) }, undefined, badge).catch(() => { /* best-effort */ })
    }
    if (webPushSender.configured) {
      const payload = JSON.stringify({ title, body, data: { kind, ...(data ?? {}) } })
      for (const sub of store.webPushSubscriptionsForUser(userId)) void webPushSender.send(sub, payload).catch(() => { /* best-effort */ })
    }
  } catch { /* 推送读失败绝不阻断/500 调用方已提交的主流程 */ }
}

/// 账号安全变更 → 预警本人（单一真相：account/recovery/passkey 各路都调此，杜绝各写各的 title/body/kind 漂移）。
/// kind 统一 `security_<event>`，经上面的 notifyUser：站内持久化 + best-effort 推送，且 `security_*` 恒越勿扰
/// （见 quietHours.isAlwaysThrough）——夜间接管当即触达。**任何登录凭据/方式的增删改都应经此**。
export function notifyAccountSecurity(store: Store, push: PushSender, user: User, event: SecurityEvent): void {
  const { title, body } = pushStrings.securityNotice(event, pushLang(user.language))
  notifyUser(store, push, user.id, `security_${event}`, title, body)
}
