/* BeeUrEi Helper Service Worker：Web Push 紧急告警。
 * 只做两件事：push 事件 → 弹系统通知；点通知 → 聚焦/打开通知页。
 * 刻意不做离线缓存（协助端是实时应用，陈旧缓存有害无益）。 */

self.addEventListener('install', () => { self.skipWaiting() })
self.addEventListener('activate', (event) => { event.waitUntil(self.clients.claim()) })

self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch { /* 非 JSON 负载忽略详情 */ }
  const title = data.title || 'BeeUrEi'
  const body = data.body || ''
  const d = data.data || {}
  // 分级（与应用内口径一致，紧急的才显得紧急）：
  // - requireInteraction 只给紧急告警/来电（不自动消失直到处理）；聊天与通用通知（好友请求/路线/
  //   举报处置…经 notifyUser 双通道）自然消退。
  // - tag 去重：来电按 callId（同一通只留一条）、聊天按会话折叠（同 APNs threadId 口径）、
  //   告警按发起人、通用按类别折叠。
  // 紧急告警负载的 kind 是具体事由（fall/crash/manual，见 emergency.ts notifData），不带 emergency 前缀。
  const urgent = d.kind === 'incoming_call' || d.kind === 'fall' || d.kind === 'crash' || d.kind === 'manual'
    || (d.kind && String(d.kind).indexOf('emergency') === 0)
  var tag = 'beeurei'
  if (d.kind === 'incoming_call' && d.callId) tag = 'call-' + d.callId
  else if (d.kind === 'chat_message') tag = d.groupId ? 'group-' + d.groupId : 'dm-' + (d.fromId || '')
  else if (urgent && d.fromId) tag = 'emergency-' + d.fromId
  else if (d.kind) tag = 'n-' + d.kind
  event.waitUntil(self.registration.showNotification(title, {
    body,
    // 系统通知走操作系统渲染，无法复用应用内的"最后已知位置"富标注——位置详情在点开后的通知页
    // （那里有诚实标注 + 回拨）。
    tag,
    requireInteraction: urgent,
    data: d,
  }))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  // 按类型直达：来电 → 首页（IncomingCallHost 全局轮询，任何 /app 页都弹铃，首页最快）；
  // 聊天 → 对应会话（单聊带 fromId 直达，群聊落消息列表）；告警 → 通知页（诚实位置标注+回拨）。
  const d0 = event.notification.data || {}
  const path = d0.kind === 'incoming_call' ? '/app/'
    : d0.kind === 'chat_message' ? (d0.fromId ? '/app/chat/' + encodeURIComponent(d0.fromId) : '/app/chat')
    : '/app/notifications'
  const target = new URL(path, self.location.origin).href
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    for (const w of wins) {
      if (w.url.startsWith(new URL('/app/', self.location.origin).href)) {
        await w.focus()
        await w.navigate(target).catch(() => {}) // 已在 /app 内：聚焦并转到通知页
        return
      }
    }
    await self.clients.openWindow(target)
  })())
})
