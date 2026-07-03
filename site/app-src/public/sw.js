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
  event.waitUntil(self.registration.showNotification(title, {
    body,
    // 系统通知走操作系统渲染，无法复用应用内的"最后已知位置"富标注——位置详情在点开后的通知页
    // （那里有诚实标注 + 回拨）。tag 去重：来电按 callId（同一通只留一条）、告警按发起人。
    tag: (data.data && data.data.kind === 'incoming_call' && data.data.callId)
      ? 'call-' + data.data.callId
      : (data.data && data.data.fromId) ? 'emergency-' + data.data.fromId : 'beeurei',
    requireInteraction: true, // 紧急告警/来电不自动消失，直到用户处理
    data: data.data || {},
  }))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  // 来电 → 首页（IncomingCallHost 全局轮询，落到任何 /app 页都会弹铃，首页最快）；告警 → 通知页（诚实位置标注+回拨）。
  const path = (event.notification.data && event.notification.data.kind === 'incoming_call') ? '/app/' : '/app/notifications'
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
