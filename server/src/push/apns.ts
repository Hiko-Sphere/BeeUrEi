import { readFileSync } from 'node:fs'
import { createPrivateKey, sign as cryptoSign, type KeyObject } from 'node:crypto'
import http2 from 'node:http2'

/// VoIP 推送发送器（A1 后台来电）。把"有人呼叫你"经 APNs 推到目标设备，
/// 由 iOS PushKit 唤起 CallKit 系统来电（即使息屏/后台）。
/// 抽象出接口便于注入/单测；默认实现零第三方依赖（Node 内置 http2 + crypto 签 ES256 JWT）。
export interface PushSender {
  /// 向某设备的 VoIP token 推送一条来电邀请。失败只记日志，绝不抛出（不阻断呼叫主流程）。
  sendCallInvite(voipToken: string, callId: string, callerName: string, callerId: string): Promise<void>
}

/// 未配置 APNs 时的空实现（前台轮询会合仍可用，仅后台/锁屏不响铃）。
export class NoopPushSender implements PushSender {
  async sendCallInvite(): Promise<void> {}
}

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

/// 真实 APNs VoIP 推送。需环境变量：APNS_KEY_PATH(.p8)、APNS_KEY_ID、APNS_TEAM_ID、APNS_TOPIC(如 com.beeurei.BeeUrEi.voip)。
/// APNS_HOST 默认沙盒 api.sandbox.push.apple.com（开发证书）；生产改 api.push.apple.com。
export class ApnsPushSender implements PushSender {
  private cachedJwt?: { token: string; iat: number }

  constructor(
    private readonly key: KeyObject,
    private readonly keyId: string,
    private readonly teamId: string,
    private readonly topic: string,
    private readonly host: string,
  ) {}

  /// APNs provider JWT（ES256）。最长有效 1h，缓存 ~40 分钟复用（APNs 限制频繁换发新 token）。
  private providerToken(nowMs: number): string {
    const iat = Math.floor(nowMs / 1000)
    if (this.cachedJwt && iat - this.cachedJwt.iat < 40 * 60) return this.cachedJwt.token
    const header = base64url(JSON.stringify({ alg: 'ES256', kid: this.keyId }))
    const payload = base64url(JSON.stringify({ iss: this.teamId, iat }))
    const signingInput = `${header}.${payload}`
    const sig = cryptoSign('sha256', Buffer.from(signingInput), { key: this.key, dsaEncoding: 'ieee-p1363' })
    const token = `${signingInput}.${base64url(sig)}`
    this.cachedJwt = { token, iat }
    return token
  }

  async sendCallInvite(voipToken: string, callId: string, callerName: string, callerId: string): Promise<void> {
    const body = JSON.stringify({ callId, caller: callerName, callerID: callerId, aps: {} })
    try {
      await this.post(`/3/device/${voipToken}`, {
        authorization: `bearer ${this.providerToken(Date.now())}`,
        'apns-topic': this.topic,
        'apns-push-type': 'voip',
        'apns-priority': '10',
        'apns-expiration': '0',
      }, body)
    } catch (err) {
      console.warn('[apns] VoIP push failed:', (err as Error).message)
    }
  }

  private post(path: string, headers: Record<string, string>, body: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const client = http2.connect(`https://${this.host}`)
      // settle 守卫：无论成功/连接错误/请求错误/超时，都确保 client 被关闭一次，杜绝失败路径上的 http2 会话/socket 泄漏（见复审 #7）。
      let settled = false
      const settle = (err?: Error) => {
        if (settled) return
        settled = true
        try { client.destroy() } catch { /* 已关闭 */ }
        if (err) reject(err)
        else resolve()
      }
      // 总超时兜底：APNs 接受连接后静默挂起（网络分区/半开连接）时不会有任何事件，
      // 没有超时则 Promise 永不 settle、会话永久泄漏（见复审 #1）。到点强制 settle 并销毁会话。
      const TIMEOUT_MS = 10_000
      client.setTimeout(TIMEOUT_MS, () => settle(new Error('APNs connect timeout')))
      client.on('error', settle)
      const req = client.request({ ':method': 'POST', ':path': path, ...headers })
      req.setTimeout(TIMEOUT_MS, () => settle(new Error('APNs request timeout')))
      let status = 0
      let data = ''
      req.on('response', (h) => { status = Number(h[':status']) })
      req.setEncoding('utf8')
      req.on('data', (c) => { data += c })
      req.on('end', () => settle(status === 200 ? undefined : new Error(`APNs ${status}: ${data}`)))
      req.on('error', settle)
      req.write(body)
      req.end()
    })
  }
}

/// 工厂：四个必需 env 齐全且能读到 .p8 才启用真实 APNs，否则 Noop（不阻断其余功能）。
export function makePushSender(): PushSender {
  const keyPath = process.env.APNS_KEY_PATH
  const keyId = process.env.APNS_KEY_ID
  const teamId = process.env.APNS_TEAM_ID
  const topic = process.env.APNS_TOPIC
  if (!keyPath || !keyId || !teamId || !topic) return new NoopPushSender()
  try {
    const key = createPrivateKey(readFileSync(keyPath, 'utf8'))
    const host = process.env.APNS_HOST ?? 'api.sandbox.push.apple.com'
    console.log(`[apns] VoIP 推送已启用（host=${host}, topic=${topic}）`)
    return new ApnsPushSender(key, keyId, teamId, topic, host)
  } catch (err) {
    console.warn('[apns] 配置不完整或 .p8 读取失败，回退无推送：', (err as Error).message)
    return new NoopPushSender()
  }
}
