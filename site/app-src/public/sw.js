/* BeeUrEi Helper Service Worker：Web Push 紧急告警。
 * 只做两件事：push 事件 → 弹系统通知；点通知 → 聚焦/打开通知页。
 * 刻意不做离线缓存（协助端是实时应用，陈旧缓存有害无益）。 */

self.addEventListener('install', () => { self.skipWaiting() })
self.addEventListener('activate', (event) => { event.waitUntil(self.clients.claim()) })

// API 源：生产的 API 是**跨源**（站点 beeurei.hikosphere.com、API beeurei-api.hikosphere.com），而 SW 是静态
// 文件、不参与打包、无法 import config——若对 API 用相对路径('/api/...')会打到**站点自身源**(无 /api)而失败。
// 由注册方(webPush.ts)把 app 解析出的 API_BASE 经 SW 自身 URL 的查询串注入；SW 从 self.location 读取。
// 本地/同源部署 apiBase='' → 相对路径(与 app 一致，走同源/代理)。跨源部署 → 绝对 API 源。
function apiBase() {
  try { return new URL(self.location.href).searchParams.get('apiBase') || '' } catch (_) { return '' }
}

// 离线兜底（仅导航请求）：**刻意不缓存任何应用资源**（实时应用，陈旧缓存有害）——离线时给一页
// 诚实的"无法连接"而非浏览器报错页。资源/接口请求原样放行（失败由应用层各自处理）。
self.addEventListener('fetch', (event) => {
  if (event.request.mode !== 'navigate') return
  event.respondWith(fetch(event.request).catch(() =>
    new Response(
      '<!doctype html><html lang="zh-Hans"><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width, initial-scale=1">' +
      '<title>BeeUrEi · 离线</title>' +
      '<body style="font-family:system-ui;display:flex;min-height:100vh;align-items:center;justify-content:center;margin:0;background:#14161f;color:#f2f3f5">' +
      '<div style="text-align:center;padding:24px"><div style="font-size:40px">📡</div>' +
      '<h1 style="font-size:18px;margin:12px 0 6px">当前离线，无法连接服务器</h1>' +
      '<p style="color:#aab1bf;font-size:14px;margin:0 0 16px">Offline — cannot reach the server.</p>' +
      '<button onclick="location.reload()" style="font-size:15px;padding:10px 22px;border-radius:10px;border:0;background:#f2a900;color:#14161f;font-weight:600">重试 / Retry</button>' +
      '</div></body></html>',
      { status: 503, headers: { 'content-type': 'text/html; charset=utf-8' } },
    )))
})

// 浏览器主动轮换订阅：SW 无 auth token——用**旧订阅三元组**（endpoint+双 key，仅本浏览器与
// 服务端持有）向 /api/push/web-rotate 证明所有权换新。失败静默：设置页的自愈重同步兜底。
self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil((async () => {
    try {
      const oldSub = event.oldSubscription
      if (!oldSub) return
      const oldJson = oldSub.toJSON()
      const newSub = event.newSubscription
        || await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: oldSub.options.applicationServerKey })
      const newJson = newSub.toJSON()
      if (!oldJson.endpoint || !oldJson.keys || !newJson.endpoint || !newJson.keys) return
      // 打到**正确的 API 源**（跨源部署下相对路径会打到站点源、404，轮换永不落库 → web-push 静默失效）。
      await fetch(apiBase() + '/api/push/web-rotate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          old: { endpoint: oldJson.endpoint, p256dh: oldJson.keys.p256dh, auth: oldJson.keys.auth },
          sub: { endpoint: newJson.endpoint, keys: { p256dh: newJson.keys.p256dh, auth: newJson.keys.auth } },
        }),
      })
    } catch { /* 尽力而为，自愈重同步兜底 */ }
  })())
})

self.addEventListener('push', (event) => {
  let data = {}
  try { data = event.data ? event.data.json() : {} } catch { /* 非 JSON 负载忽略详情 */ }
  // PWA 图标角标（Badging API）：App 完全关闭时也能从图标看到未读总数——服务端在推送负载顶层带上
  // 收件人当前未读总数 badge（与 APNs 图标角标同口径）。>0 置数、<=0 清；不支持/抛错静默跳过。
  if (typeof data.badge === 'number' && 'setAppBadge' in navigator) {
    event.waitUntil((async () => {
      try { data.badge > 0 ? await navigator.setAppBadge(data.badge) : await navigator.clearAppBadge() } catch (_) { /* best-effort */ }
    })())
  }
  const title = data.title || 'BeeUrEi'
  const body = data.body || ''
  const d = data.data || {}
  // 分级（与应用内口径一致，紧急的才显得紧急）：
  // - requireInteraction 只给紧急告警/来电（不自动消失直到处理）；聊天与通用通知（好友请求/路线/
  //   举报处置…经 notifyUser 双通道）自然消退。
  // - tag 去重：来电按 callId（同一通只留一条）、聊天按会话折叠（同 APNs threadId 口径）、
  //   告警按发起人、通用按类别折叠。
  // 紧急判定**只认** data.type==='emergency_alert'（服务端对所有紧急**告警**统一带的可靠标记，与 APNs extra 同
  // 口径：SOS 首呼/升级/安全报到未到皆带）+ 来电 + 首呼具体事由 kind(fall/crash/manual)。
  // **绝不**再用 indexOf('emergency') 宽匹配——它会把紧急告警的**后续**（emergency_clear 报平安 /
  // emergency_responding 有人响应 / emergency_ack 已确认，皆非告警本身、皆不带 type）也误判为紧急，变成不
  // 自动消退的常驻横幅：报平安"我没事了"本该是安心通知，却被弄成催人处理的红色常驻，与其语义相反。
  const urgent = d.type === 'emergency_alert'
    || d.kind === 'incoming_call' || d.kind === 'fall' || d.kind === 'crash' || d.kind === 'manual'
  var tag = 'beeurei'
  if (d.kind === 'incoming_call' && d.callId) tag = 'call-' + d.callId
  else if (d.kind === 'chat_message') tag = d.groupId ? 'group-' + d.groupId : 'dm-' + (d.fromId || '')
  // 报平安(emergency_clear)与其告警共用 fromId 线：**替换**掉家人屏上那条常驻 SOS 横幅（"我没事了"取代警报），
  // 但它本身不 requireInteraction（上面 urgent 不含它）——替换＋自动消退，正是"解除"该有的样子。
  else if ((urgent || d.kind === 'emergency_clear') && d.fromId) tag = 'emergency-' + d.fromId
  else if (d.kind) tag = 'n-' + d.kind
  event.waitUntil(self.registration.showNotification(title, {
    body,
    // 系统通知走操作系统渲染，无法复用应用内的"最后已知位置"富标注——位置详情在点开后的通知页
    // （那里有诚实标注 + 回拨）。
    tag,
    requireInteraction: urgent,
    // renotify 只给紧急告警：**升级重呼**与告警首呼共用同一 tag(emergency-<fromId>)，默认 renotify=false 时
    // 同 tag 的后续会**静默替换**横幅（不再响铃/振动/重新弹出）——恰好抹掉了升级"抓住漏看首呼的人"的全部意义。
    // 置 true 强制每条紧急告警都重新惊动协助者（renotify 依赖 tag，而 urgent 恒有 tag，安全）。报平安
    // emergency_clear 不 urgent → renotify=false → 悄悄替换掉常驻 SOS 横幅（"我没事了"不该再拉响警报，语义正确）。
    renotify: urgent,
    // 紧急告警加**振动**（医疗/急救 App 标配"让告警被感知到而非仅看到"）：协助者多在手机上、可能没盯屏，
    // 一段醒目的三段振动比静默横幅更可能被注意到。仅 Android Chrome 等支持者生效，其余浏览器忽略（无害）。
    // 非紧急（聊天/好友请求等）不覆盖振动，交由系统默认，免频繁震动打扰。
    vibrate: urgent ? [300, 120, 300, 120, 300] : undefined,
    data: d,
  }))
})

self.addEventListener('notificationclick', (event) => {
  event.notification.close()
  // 按类型直达：来电 → 首页（IncomingCallHost 全局轮询，任何 /app 页都弹铃，首页最快）；
  // 聊天 → 对应会话（单聊带 fromId 直达，群聊落消息列表）；告警 → 通知页（诚实位置标注+回拨）。
  const d0 = event.notification.data || {}
  // 聊天：单聊按 fromId 直达对端会话、群聊按 groupId 直达该群（/app/chat/g/<id>，与单聊 /app/chat/<peerId> 对称）；
  // 二者皆缺才落聊天列表。群消息 web push 服务端带 groupId（见 messages.ts 群扇出），此前 SW 只认 fromId、
  // 群消息点开只到列表、还得再找那个群——补齐群深链。
  const path = d0.kind === 'incoming_call' ? '/app/'
    : d0.kind === 'chat_message'
      ? (d0.fromId ? '/app/chat/' + encodeURIComponent(d0.fromId)
        : d0.groupId ? '/app/chat/g/' + encodeURIComponent(d0.groupId)
        : '/app/chat')
    // 请求共享位置（可操作 nudge）：直达位置页——那里就是"开始共享"的开关（与应用内 NotifDestination 一致）。
    // 落通知收件箱还得再翻去位置页才能响应。location_request 绝非告警，路由无歧义。
    : d0.kind === 'location_request' ? '/app/locations'
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
