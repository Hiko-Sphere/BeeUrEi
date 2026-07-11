import webpush from 'web-push'

/// Web Push（VAPID）发送器——补紧急链路的残留真洞：web-only 协助者（无 APNs token）**关掉标签页
/// 后完全收不到告警**（应用内模态只在页面打开时轮询）。行业答案 = 标准 Web Push：浏览器订阅
/// （Service Worker + PushManager）→ 服务端用 VAPID 私钥签名推给浏览器厂商推送服务 → SW 弹系统通知。
///
/// 与 APNs 同一诚实模式：VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY/VAPID_SUBJECT 三者齐才真发；
/// 未配置 = Noop（订阅端点 503，绝不假装已推送）。密钥一次性生成：`npx web-push generate-vapid-keys`。
export interface WebPushSubscriptionKeys {
  endpoint: string
  p256dh: string
  auth: string
}

/// 单次发送结果：'sent'=浏览器推送服务已受理（真送达）；'gone'=订阅已死(410/404)、已回收但**未送达**。
/// 扇出调用方历来忽略返回值（best-effort .catch/allSettled），故加此返回值不破坏它们；而自测端点据此**如实**
/// 区分"真送达"与"死订阅被回收"——否则把 'gone' 当成功会给安全 web-push 通道假安心（订阅存在≠能送达）。
export type WebPushOutcome = 'sent' | 'gone'

export interface WebPushSender {
  readonly configured: boolean
  /// 推送一条 JSON 负载到订阅端点。410/404（订阅已失效：用户清了站点数据/换浏览器）时
  /// 调用 onGone 回收订阅——与 APNs 410 回收 token 同口径，避免反复空投死订阅——并返回 'gone'（未送达）。
  send(sub: WebPushSubscriptionKeys, payload: string): Promise<WebPushOutcome>
}

export class NoopWebPushSender implements WebPushSender {
  readonly configured = false
  async send(): Promise<WebPushOutcome> { return 'sent' /* 未配置 VAPID：无订阅可发（入口 503），返回值不被消费 */ }
}

export class VapidWebPushSender implements WebPushSender {
  readonly configured = true
  constructor(publicKey: string, privateKey: string, subject: string,
              private onGone?: (endpoint: string) => void) {
    webpush.setVapidDetails(subject, publicKey, privateKey)
  }

  async send(sub: WebPushSubscriptionKeys, payload: string): Promise<WebPushOutcome> {
    try {
      await webpush.sendNotification(
        { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
        payload,
        { TTL: 300, urgency: 'high' }, // 紧急告警：高优先级、5 分钟内送达否则过期（过时告警无意义）
      )
      return 'sent'
    } catch (e) {
      const status = (e as { statusCode?: number }).statusCode
      if (status === 404 || status === 410) {
        this.onGone?.(sub.endpoint) // 订阅已死：回收，不再空投
        return 'gone' // 已回收但**未送达**——自测须据此计为未送达，勿假报成功
      }
      throw e // 其余错误交调用方（调用方均 best-effort allSettled，不阻断告警主流程）
    }
  }
}

/// 计数装饰器：把任意 WebPushSender 包上 Prometheus 计数——推送已是紧急链路的承重通道，
/// 送达健康度必须可观测（web_push_sent_total / web_push_failed_total）。在 buildApp 单点包裹，
/// 四处扇出调用点（emergency/assist/messages/notifyUser）零改动。
/// 口径：sent=send 正常返回（含 410 回收死订阅——那是"正确处理"非故障）；failed=抛错（上游 5xx/网络）。
export class CountingWebPushSender implements WebPushSender {
  constructor(private inner: WebPushSender, private count: (name: string) => void) {}
  get configured(): boolean { return this.inner.configured }
  async send(sub: WebPushSubscriptionKeys, payload: string): Promise<WebPushOutcome> {
    try {
      const outcome = await this.inner.send(sub, payload)
      this.count('web_push_sent_total') // 口径不变：非抛错即计 sent（含 410 回收——那是"正确处理"非故障）
      return outcome // 透传 'sent'/'gone' 供自测如实区分（此前吞成 void 令自测把死订阅当已送达）
    } catch (e) {
      this.count('web_push_failed_total')
      throw e
    }
  }
}

/// 从环境构造：三个 VAPID 变量齐才真发（subject 须为 mailto: 或 https: URL，规范要求）。
export function makeWebPushSender(onGone?: (endpoint: string) => void): WebPushSender {
  const pub = process.env.VAPID_PUBLIC_KEY
  const priv = process.env.VAPID_PRIVATE_KEY
  const subject = process.env.VAPID_SUBJECT
  if (!pub || !priv || !subject) return new NoopWebPushSender()
  return new VapidWebPushSender(pub, priv, subject, onGone)
}
