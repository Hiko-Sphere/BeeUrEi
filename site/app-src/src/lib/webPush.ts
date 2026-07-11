import { api } from './api'
import { API_BASE, apiURL } from './config'

// SW 注册 URL：把 app 解析出的 API_BASE 经查询串注入 SW，供其 pushsubscriptionchange 轮换时打到**正确的 API 源**
// （SW 是静态文件、无法 import config；跨源部署下相对 '/api' 会打到站点源 404 → 轮换后 web-push 静默失效）。
// scope 由路径 '/app/' 决定、不含查询串，故 getRegistration('/app/sw.js') 仍匹配同一注册。API_BASE 为空(同源/本地)
// 则不带查询串、SW 回退相对路径。
const SW_URL = '/app/sw.js' + (API_BASE ? '?apiBase=' + encodeURIComponent(API_BASE) : '')

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

/// 应用启动即注册 SW（**不**请求通知权限、**不**订阅推送）：让所有协助者都获得 SW 的离线兜底页（导航请求失败→
/// 诚实"无法连接"页，而非浏览器报错页），而非只有开了 Web Push 的人才有。用与 subscribeWebPush 同一 SW_URL
/// （含 apiBase 查询串），故后续开推送时不会因 scriptURL 不同触发重装。best-effort：不支持/失败静默。
export async function registerServiceWorker(): Promise<void> {
  try {
    if (!('serviceWorker' in navigator)) return
    await navigator.serviceWorker.register(SW_URL)
  } catch { /* 尽力而为 */ }
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
  const reg = await navigator.serviceWorker.register(SW_URL)
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

/// 自愈重同步：浏览器侧订阅存在但服务端行可能已没（上限驱逐/410 回收/封禁再启用/换库恢复）
/// ——此时设置开关显示"已开启"但实际收不到，**假安心比没有更危险**。设置页初始化时调用：
/// 把现有浏览器订阅幂等重传服务端（upsert，端点相同不产生新行），任何分歧在用户下次看设置时
/// 自动修复。失败静默（下次再试）。
export async function resyncWebPushSubscription(): Promise<void> {
  try {
    if (!webPushSupported() || Notification.permission !== 'granted') return
    const reg = await navigator.serviceWorker.getRegistration('/app/sw.js')
    const sub = await reg?.pushManager.getSubscription()
    if (!sub) return
    const json = sub.toJSON()
    if (!json.endpoint || !json.keys?.p256dh || !json.keys?.auth) return
    await api.webPushSubscribe({ endpoint: json.endpoint, keys: { p256dh: json.keys.p256dh, auth: json.keys.auth } })
  } catch { /* 尽力而为，设置页下次打开再试 */ }
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
