import { api } from './api'
import { apiURL } from './config'

/// Web Push 订阅编排（浏览器推送紧急告警——关掉标签页也能收到系统通知）。
/// 流程：SW 注册 → 服务端取 VAPID 公钥（未配置 503 → 'unsupported'）→ 请求通知权限 →
/// PushManager 订阅 → 上报服务端。全程幂等：已订阅则复用现有订阅只重新上报。
export type WebPushStatus = 'subscribed' | 'denied' | 'unsupported'

/// VAPID 公钥（base64url）→ Uint8Array（PushManager.subscribe 的 applicationServerKey 要求）。
export function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(b64)
  const out = new Uint8Array(raw.length)
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

export function webPushSupported(): boolean {
  return 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

export async function subscribeWebPush(): Promise<WebPushStatus> {
  if (!webPushSupported()) return 'unsupported'
  let key: string
  try {
    key = (await api.webVapidKey()).key
  } catch {
    return 'unsupported' // 服务端未配 VAPID（503）：诚实报不可用，不假装订阅成功
  }
  const perm = await Notification.requestPermission()
  if (perm !== 'granted') return 'denied'
  const reg = await navigator.serviceWorker.register('/app/sw.js')
  await navigator.serviceWorker.ready
  const sub = (await reg.pushManager.getSubscription())
    ?? (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(key) as BufferSource }))
  const json = sub.toJSON()
  if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return 'unsupported'
  await api.webPushSubscribe({ endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } })
  return 'subscribed'
}

export async function unsubscribeWebPush(): Promise<void> {
  if (!webPushSupported()) return
  const reg = await navigator.serviceWorker.getRegistration('/app/sw.js')
  const sub = await reg?.pushManager.getSubscription()
  if (!sub) return
  // 先通知服务端删订阅，再本地退订（顺序无关紧要，都 best-effort）。
  await api.webPushUnsubscribe(sub.endpoint).catch(() => {})
  await sub.unsubscribe().catch(() => {})
}

/// 当前是否已订阅（供设置页开关初始态）。
export async function isWebPushSubscribed(): Promise<boolean> {
  if (!webPushSupported() || Notification.permission !== 'granted') return false
  const reg = await navigator.serviceWorker.getRegistration('/app/sw.js')
  return !!(await reg?.pushManager.getSubscription())
}

/// 登出专用退订：与 iOS 登出注销 APNs/VoIP token 同一口径（防已登出的共享电脑继续弹出
/// 家人的紧急告警/消息系统通知——隐私泄漏）。token 由调用方**在清除前同步快照**传入
/// （退订是异步的，等它跑起来 tokenStore 已被清）；全程尽力而为，离线登出照常瞬时完成。
export async function unsubscribeWebPushOnSignOut(token: string): Promise<void> {
  try {
    if (!('serviceWorker' in navigator)) return
    const reg = await navigator.serviceWorker.getRegistration('/app/sw.js')
    const sub = await reg?.pushManager.getSubscription()
    if (!sub) return
    await fetch(apiURL('/api/push/web-subscribe'), {
      method: 'DELETE',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ endpoint: sub.endpoint }),
    }).catch(() => {})
    await sub.unsubscribe().catch(() => {}) // 浏览器侧也退：双保险，服务端删失败也不再收推
  } catch { /* 尽力而为 */ }
}
