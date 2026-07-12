import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import { createServer, type Server } from 'node:https'
import { Agent } from 'node:https'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createECDH, createDecipheriv, createPublicKey, hkdfSync, randomBytes, verify as cryptoVerify, type ECDH } from 'node:crypto'
import webpush from 'web-push'
import { VapidWebPushSender, CountingWebPushSender, makeWebPushSender } from '../src/push/webPush'

/// Web Push 发送管线的**真实密码学互操作**测试（此前 58% 覆盖：VapidWebPushSender.send 从未被测，
/// 加密若有差错=浏览器静默丢弃推送，紧急告警链路无声失效——最危险的失败形态）。
/// 无 mock：真本地 HTTPS 服务（openssl 现场自签+Agent CA 全校验）扮演浏览器推送服务收 POST；真 P-256 ECDH 密钥对扮演浏览器订阅方，
/// 按 RFC 8291/8188 用 node:crypto 解密 aes128gcm 密文，证明**真浏览器解得开我们发的负载**；
/// VAPID JWT 用真 ES256 验签（aud/sub/exp 逐项核）。
const VAPID = webpush.generateVAPIDKeys() // 真密钥（库自身的生成器，与生产 npx web-push 同源）
const SUBJECT = 'mailto:ops@hikosphere.com'

// —— 浏览器侧：真 ECDH P-256 订阅密钥 + 16 字节 auth secret（PushManager.subscribe 的等价物）——
let browser: ECDH
let authSecret: Buffer
const subKeys = () => ({
  p256dh: browser.getPublicKey().toString('base64url'),
  auth: authSecret.toString('base64url'),
})

/// RFC 8291（Web Push 加密）+ RFC 8188（aes128gcm）解密——浏览器收到推送后做的事。
function decryptWebPush(body: Buffer): Buffer {
  const salt = body.subarray(0, 16)
  const idlen = body[20]
  const asPub = body.subarray(21, 21 + idlen) // 服务端临时公钥（keyid 字段，65 字节未压缩点）
  const ct = body.subarray(21 + idlen)
  const ecdhSecret = browser.computeSecret(asPub)
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0'), browser.getPublicKey(), asPub])
  const ikm = Buffer.from(hkdfSync('sha256', ecdhSecret, authSecret, keyInfo, 32))
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16))
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12))
  const dec = createDecipheriv('aes-128-gcm', cek, nonce)
  dec.setAuthTag(ct.subarray(ct.length - 16))
  const padded = Buffer.concat([dec.update(ct.subarray(0, ct.length - 16)), dec.final()])
  let end = padded.length // 末记录填充：明文 | 0x02 | 0x00*
  while (end > 0 && padded[end - 1] === 0) end--
  if (padded[end - 1] !== 2) throw new Error('bad_rfc8188_padding')
  return padded.subarray(0, end - 1)
}

/// VAPID（RFC 8292）验证——推送服务收到请求后做的事：ES256 验签 + aud/sub/exp。
function assertVapidValid(authz: string | undefined, origin: string) {
  const m = /vapid\s+t=([^,\s]+),\s*k=([^,;\s]+)/i.exec(authz ?? '')
  expect(m, `Authorization 头不是 vapid 格式：${authz}`).toBeTruthy()
  const [, jwt, k] = m!
  expect(k).toBe(VAPID.publicKey) // k= 必须是我们的 VAPID 公钥
  const [h, p, s] = jwt.split('.')
  const raw = Buffer.from(VAPID.publicKey, 'base64url') // 65 字节未压缩 EC 点 → JWK
  const key = createPublicKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256', x: raw.subarray(1, 33).toString('base64url'), y: raw.subarray(33, 65).toString('base64url') } })
  expect(cryptoVerify('sha256', Buffer.from(`${h}.${p}`), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(s, 'base64url'))).toBe(true)
  const claims = JSON.parse(Buffer.from(p, 'base64url').toString())
  expect(claims.aud).toBe(origin) // aud=推送服务源——发错 aud 会被 FCM/Mozilla 拒收
  expect(claims.sub).toBe(SUBJECT)
  expect(claims.exp * 1000).toBeGreaterThan(Date.now())
}

// —— 真本地"浏览器推送服务"：**真 TLS**（web-push 库强制走 https 模块）。openssl 现场自签
// SAN=IP:127.0.0.1 的证书，客户端经 https.Agent({ca}) 做**完整链校验**（不关 rejectUnauthorized）。
let pushService: Server
let origin = ''
let tlsAgent: Agent
let certDir = ''
let respondStatus = 201
let captured: { body: Buffer; headers: Record<string, string | string[] | undefined> } | null = null

beforeAll(async () => {
  certDir = mkdtempSync(join(tmpdir(), 'beeurei-webpush-tls-'))
  execFileSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:P-256',
    '-keyout', join(certDir, 'key.pem'), '-out', join(certDir, 'cert.pem'), '-nodes', '-days', '2',
    '-subj', '/CN=127.0.0.1', '-addext', 'subjectAltName=IP:127.0.0.1'], { stdio: 'pipe' })
  const cert = readFileSync(join(certDir, 'cert.pem'))
  tlsAgent = new Agent({ ca: cert })
  pushService = createServer({ key: readFileSync(join(certDir, 'key.pem')), cert }, (req, res) => {
    const chunks: Buffer[] = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      captured = { body: Buffer.concat(chunks), headers: req.headers }
      res.writeHead(respondStatus).end()
    })
  })
  await new Promise<void>((r) => pushService.listen(0, '127.0.0.1', r))
  origin = `https://127.0.0.1:${(pushService.address() as { port: number }).port}`
})
afterAll(async () => {
  await new Promise((r) => pushService.close(r))
  rmSync(certDir, { recursive: true, force: true })
})
beforeEach(() => {
  browser = createECDH('prime256v1')
  browser.generateKeys()
  authSecret = randomBytes(16)
  respondStatus = 201
  captured = null
})

describe('VapidWebPushSender：真加密→真解密互操作（紧急告警的承重通道）', () => {
  it('发送的 aes128gcm 密文能被浏览器侧真实解密为原负载；TTL/urgency/编码头齐全；VAPID JWT 验签通过', async () => {
    const sender = new VapidWebPushSender(VAPID.publicKey, VAPID.privateKey, SUBJECT, undefined, tlsAgent)
    const payload = JSON.stringify({ kind: 'emergency', title: '紧急求助', body: '李奶奶发起了紧急呼叫', url: '/app/#/emergency' })
    const outcome = await sender.send({ endpoint: `${origin}/push/sub-1`, ...subKeys() }, payload)
    expect(outcome).toBe('sent')
    expect(captured).not.toBeNull()
    expect(decryptWebPush(captured!.body).toString()).toBe(payload) // ← 互操作核心：解不开=全链路无声失效
    expect(captured!.headers['content-encoding']).toBe('aes128gcm')
    expect(captured!.headers.ttl).toBe('300')      // 紧急告警 5 分钟过期，过时告警无意义
    expect(captured!.headers.urgency).toBe('high') // 高优先级：设备省电模式也要唤醒
    assertVapidValid(captured!.headers.authorization as string, origin)
  })

  it('410/404（订阅已死）→ 回收回调收到 endpoint、返回 gone（未送达，自测不得当成功）', async () => {
    const goneEndpoints: string[] = []
    const sender = new VapidWebPushSender(VAPID.publicKey, VAPID.privateKey, SUBJECT, (ep) => goneEndpoints.push(ep), tlsAgent)
    respondStatus = 410
    expect(await sender.send({ endpoint: `${origin}/push/dead-1`, ...subKeys() }, '{}')).toBe('gone')
    respondStatus = 404
    expect(await sender.send({ endpoint: `${origin}/push/dead-2`, ...subKeys() }, '{}')).toBe('gone')
    expect(goneEndpoints).toEqual([`${origin}/push/dead-1`, `${origin}/push/dead-2`])
  })

  it('推送服务 5xx → 抛错（交调用方 best-effort），不触发回收（临时故障≠死订阅）', async () => {
    const goneEndpoints: string[] = []
    const sender = new VapidWebPushSender(VAPID.publicKey, VAPID.privateKey, SUBJECT, (ep) => goneEndpoints.push(ep), tlsAgent)
    respondStatus = 500
    // 断言到 statusCode（而非任意抛错）——曾因 TLS 握手 EPROTO 也算"抛错"而假通过。
    await expect(sender.send({ endpoint: `${origin}/push/s1`, ...subKeys() }, '{}')).rejects.toMatchObject({ statusCode: 500 })
    expect(goneEndpoints).toEqual([]) // 5xx 不能误杀订阅——下轮重试也许就通了
  })

  it('CountingWebPushSender：成功计 sent、抛错计 failed、gone 透传且计 sent（回收=正确处理非故障）', async () => {
    const counts: Record<string, number> = {}
    const counting = new CountingWebPushSender(
      new VapidWebPushSender(VAPID.publicKey, VAPID.privateKey, SUBJECT, () => {}, tlsAgent),
      (name) => { counts[name] = (counts[name] ?? 0) + 1 },
    )
    expect(counting.configured).toBe(true)
    expect(await counting.send({ endpoint: `${origin}/push/c1`, ...subKeys() }, '{"a":1}')).toBe('sent')
    respondStatus = 410
    expect(await counting.send({ endpoint: `${origin}/push/c2`, ...subKeys() }, '{}')).toBe('gone')
    respondStatus = 503
    await expect(counting.send({ endpoint: `${origin}/push/c3`, ...subKeys() }, '{}')).rejects.toMatchObject({ statusCode: 503 })
    expect(counts).toEqual({ web_push_sent_total: 2, web_push_failed_total: 1 })
  })
})

describe('makeWebPushSender：VAPID 三变量齐才真发（诚实模式，缺一即 Noop）', () => {
  const K = ['VAPID_PUBLIC_KEY', 'VAPID_PRIVATE_KEY', 'VAPID_SUBJECT'] as const
  const saved = K.map((k) => process.env[k])
  const restore = () => K.forEach((k, i) => { if (saved[i] === undefined) delete process.env[k]; else process.env[k] = saved[i] })

  it('三者齐 → 真发送器；任缺一 → Noop（绝不假装已推送）', () => {
    try {
      process.env.VAPID_PUBLIC_KEY = VAPID.publicKey
      process.env.VAPID_PRIVATE_KEY = VAPID.privateKey
      process.env.VAPID_SUBJECT = SUBJECT
      expect(makeWebPushSender().configured).toBe(true)
      for (const k of K) {
        const v = process.env[k]!
        delete process.env[k]
        expect(makeWebPushSender().configured, `缺 ${k} 仍 configured=true`).toBe(false)
        process.env[k] = v
      }
    } finally { restore() }
  })
})
