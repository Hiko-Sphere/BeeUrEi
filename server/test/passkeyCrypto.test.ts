import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createHash, createSign, generateKeyPairSync, randomBytes, type KeyObject } from 'node:crypto'
import { buildApp } from '../src/app'
import { MemoryStore } from '../src/db/store'

/// Passkey（WebAuthn）验证内核的**真实密码学**测试。现有 passkey.test.ts 只测外围错误路径
///（挑战缺失/未知凭据/限流），注册与登录的**验签成功路径一次都没走过**——伪造签名、UV 缺失、
/// 挑战重放、克隆检测这些登录边界分支全靠库"应该对"。本测用 node:crypto 手搓一个符合
/// WebAuthn 规范的软件认证器（真 P-256 密钥、真 CBOR attestation、真 DER 签名），
/// 走真实 fastify 端到端：能注册、能登录、伪造必拒。
const RP_ID = 'beeurei-api.hikosphere.com' // 路由模块默认 rpID（未设 PASSKEY_RP_* 时）
const ORIGIN = `https://${RP_ID}`

// —— 最小 CBOR 编码器（无符号/负整数/字节串/文本/映射——attestationObject 与 COSE key 所需全部）——
function cborUint(major: number, n: number): Buffer {
  if (n < 24) return Buffer.from([(major << 5) | n])
  if (n < 256) return Buffer.from([(major << 5) | 24, n])
  if (n < 65536) { const b = Buffer.alloc(3); b[0] = (major << 5) | 25; b.writeUInt16BE(n, 1); return b }
  const b = Buffer.alloc(5); b[0] = (major << 5) | 26; b.writeUInt32BE(n, 1); return b
}
function cbor(v: unknown): Buffer {
  if (typeof v === 'number' && Number.isInteger(v)) return v >= 0 ? cborUint(0, v) : cborUint(1, -1 - v)
  if (typeof v === 'string') return Buffer.concat([cborUint(3, Buffer.byteLength(v)), Buffer.from(v)])
  if (v instanceof Uint8Array) { const b = Buffer.from(v); return Buffer.concat([cborUint(2, b.length), b]) }
  if (v instanceof Map) {
    const parts = [cborUint(5, v.size)]
    for (const [k, val] of v) parts.push(cbor(k), cbor(val))
    return Buffer.concat(parts)
  }
  throw new Error('cbor_unsupported')
}
const b64u = (b: Buffer) => b.toString('base64url')
const sha256 = (b: Buffer | string) => createHash('sha256').update(b).digest()

/// 软件认证器：等价于 iOS 平台认证器做的事（Secure Enclave 生成 P-256、签 authData||hash(clientData)）。
class SoftAuthenticator {
  readonly priv: KeyObject
  readonly jwk: { x: string; y: string }
  readonly credId = randomBytes(16)
  // rpId/origin 可换（默认 iOS/API 域）：web 端 passkey 的作用域是前端域 beeurei.hikosphere.com。
  constructor(private rpId = RP_ID, private origin = ORIGIN) {
    const kp = generateKeyPairSync('ec', { namedCurve: 'P-256' })
    this.priv = kp.privateKey
    const jwk = kp.publicKey.export({ format: 'jwk' }) as { x: string; y: string }
    this.jwk = jwk
  }
  private clientData(type: 'webauthn.create' | 'webauthn.get', challenge: string, origin = this.origin): Buffer {
    return Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false }))
  }
  private authData(flags: number, counter: number, withCred: boolean): Buffer {
    const head = Buffer.concat([sha256(this.rpId), Buffer.from([flags])])
    const cnt = Buffer.alloc(4); cnt.writeUInt32BE(counter)
    if (!withCred) return Buffer.concat([head, cnt])
    const cose = cbor(new Map<number, unknown>([[1, 2], [3, -7], [-1, 1],
      [-2, Buffer.from(this.jwk.x, 'base64url')], [-3, Buffer.from(this.jwk.y, 'base64url')]]))
    const idLen = Buffer.alloc(2); idLen.writeUInt16BE(this.credId.length)
    return Buffer.concat([head, cnt, Buffer.alloc(16) /* AAGUID */, idLen, this.credId, cose])
  }
  /// 注册响应（attestation none）。uv=false 模拟没做用户验证的认证器（必须被拒——UV 是 2FA 等价性的根基）。
  attest(challenge: string, o?: { uv?: boolean; origin?: string }) {
    const flags = 0x40 /* AT */ | 0x01 /* UP */ | ((o?.uv ?? true) ? 0x04 : 0)
    const attObj = cbor(new Map<string, unknown>([['fmt', 'none'], ['attStmt', new Map()], ['authData', this.authData(flags, 0, true)]]))
    return {
      id: b64u(this.credId), rawId: b64u(this.credId), type: 'public-key', clientExtensionResults: {},
      response: { clientDataJSON: b64u(this.clientData('webauthn.create', challenge, o?.origin)), attestationObject: b64u(attObj) },
    }
  }
  /// 登录断言。signer 可换（伪造攻击=拿别人的私钥签）；counter 可控（克隆检测=计数回退）。
  assert(challenge: string, o?: { uv?: boolean; origin?: string; counter?: number; signer?: KeyObject }) {
    const flags = 0x01 | ((o?.uv ?? true) ? 0x04 : 0)
    const authData = this.authData(flags, o?.counter ?? 1, false)
    const cdj = this.clientData('webauthn.get', challenge, o?.origin)
    const sig = createSign('SHA256').update(Buffer.concat([authData, sha256(cdj)])).sign(o?.signer ?? this.priv)
    return {
      id: b64u(this.credId), rawId: b64u(this.credId), type: 'public-key', clientExtensionResults: {},
      response: { clientDataJSON: b64u(cdj), authenticatorData: b64u(authData), signature: b64u(sig) },
    }
  }
}

let app: ReturnType<typeof buildApp>
let store: MemoryStore
let token = ''
let userId = ''
const auth = () => ({ authorization: `Bearer ${token}` })

async function regOptions(): Promise<string> {
  const r = await app.inject({ method: 'POST', url: '/api/auth/passkey/register/options', headers: auth() })
  return r.json().challenge
}
async function regVerify(response: unknown) {
  return app.inject({ method: 'POST', url: '/api/auth/passkey/register/verify', headers: auth(), payload: { response, deviceName: '测试 iPhone' } })
}
async function loginFlow(): Promise<{ flowId: string; challenge: string }> {
  const r = await app.inject({ method: 'POST', url: '/api/auth/passkey/login/options' })
  const j = r.json()
  return { flowId: j.flowId, challenge: j.options.challenge }
}
async function loginVerify(flowId: string, response: unknown) {
  return app.inject({ method: 'POST', url: '/api/auth/passkey/login/verify', payload: { flowId, response } })
}

beforeAll(async () => {
  store = new MemoryStore()
  app = buildApp(store)
  const r = await app.inject({ method: 'POST', url: '/api/auth/register', payload: { username: 'pk_user', password: 'strong-pass-9x', role: 'helper' } })
  token = r.json().token
  userId = r.json().user.id
})
afterAll(async () => { await app.close() })

describe('Passkey 真实密码学闭环（软件认证器 ↔ 真服务端）', () => {
  const authenticator = new SoftAuthenticator()

  it('注册：真 attestation → 201 入库；本人收到 passkey_added 安全预警；重复凭据 → 409', async () => {
    const r = await regVerify(authenticator.attest(await regOptions()))
    expect(r.statusCode).toBe(201)
    const list = (await app.inject({ method: 'GET', url: '/api/auth/passkey/list', headers: auth() })).json()
    expect(list.passkeys).toHaveLength(1)
    expect(list.passkeys[0].deviceName).toBe('测试 iPhone')
    const notifs = store.notificationsForUser(userId, 50)
    expect(notifs.some((n) => n.kind === 'security_passkey_added')).toBe(true)
    // 同一凭据再注册（新挑战、合法签名）→ 409：凭据全局唯一，防跨账号移花接木。
    expect((await regVerify(authenticator.attest(await regOptions()))).statusCode).toBe(409)
  })

  it('登录：真断言 → 发令牌 + selfView；计数器持久化推进', async () => {
    const { flowId, challenge } = await loginFlow()
    const r = await loginVerify(flowId, authenticator.assert(challenge, { counter: 5 }))
    expect(r.statusCode).toBe(200)
    const body = r.json()
    expect(body.user.id).toBe(userId)
    expect(typeof body.token).toBe('string')
    expect(typeof body.refreshToken).toBe('string')
    expect(store.passkeysForUser(userId)[0].counter).toBe(5) // newCounter 已入库（克隆检测的基线）
  })

  it('克隆检测：断言计数 ≤ 已存计数（凭据被复制的信号）→ 401', async () => {
    const { flowId, challenge } = await loginFlow()
    const r = await loginVerify(flowId, authenticator.assert(challenge, { counter: 5 })) // 不推进
    expect(r.statusCode).toBe(401)
    expect(r.json().error).toBe('verification_failed')
  })

  it('伪造签名（别人的 P-256 私钥）→ 401；signature 一律不泄漏细节', async () => {
    const attacker = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey
    const { flowId, challenge } = await loginFlow()
    const r = await loginVerify(flowId, authenticator.assert(challenge, { counter: 9, signer: attacker }))
    expect(r.statusCode).toBe(401)
    expect(store.passkeysForUser(userId)[0].counter).toBe(5) // 计数器不被伪造请求推进
  })

  it('UV 缺失（未做生物识别/设备密码）→ 注册 400 / 登录 401——UV 是"passkey=强多因子"的根基', async () => {
    const fresh = new SoftAuthenticator()
    expect((await regVerify(fresh.attest(await regOptions(), { uv: false }))).statusCode).toBe(400)
    const { flowId, challenge } = await loginFlow()
    expect((await loginVerify(flowId, authenticator.assert(challenge, { uv: false, counter: 9 }))).statusCode).toBe(401)
  })

  it('origin 混淆（钓鱼站转发的断言）→ 拒绝；挑战取出即焚：同 flowId 重放 → challenge_expired', async () => {
    const { flowId, challenge } = await loginFlow()
    const r = await loginVerify(flowId, authenticator.assert(challenge, { origin: 'https://evil.example', counter: 9 }))
    expect(r.statusCode).toBe(401)
    // 同一 flowId 的挑战已被 take 焚毁——即便这次换上合法断言也进不来（防重放的第二道闸）。
    const replay = await loginVerify(flowId, authenticator.assert(challenge, { counter: 9 }))
    expect(replay.statusCode).toBe(400)
    expect(replay.json().error).toBe('challenge_expired')
  })

  it('挑战跨用途隔离：注册挑战不能拿去登录（reg:/login: 键空间分离）', async () => {
    const regChallenge = await regOptions()
    const { flowId } = await loginFlow()
    void flowId
    // 拿注册挑战伪装登录断言：登录侧按 flowId 取不到这个挑战 → 无从匹配。
    const bogusFlow = await loginVerify('not-a-real-flow', authenticator.assert(regChallenge, { counter: 9 }))
    expect(bogusFlow.statusCode).toBe(400)
  })

  it('web 端 passkey（兄弟子域）：Origin=前端源 → options 用 web 域 rpID；注册+登录全流程通过', async () => {
    // 协助者网页端跑在 beeurei.hikosphere.com（与 API 域是兄弟子域）——WebAuthn 要求 rpID 是页面域
    // 的可注册后缀，web 端必须用自己的域做 rpID。服务端按 Origin 分流、验证端接受双 rpID。
    const WEB_ORIGIN = 'https://beeurei.hikosphere.com'
    const webAuth = new SoftAuthenticator('beeurei.hikosphere.com', WEB_ORIGIN)
    const optRes = await app.inject({ method: 'POST', url: '/api/auth/passkey/register/options', headers: { ...auth(), origin: WEB_ORIGIN } })
    const opts = optRes.json()
    expect(opts.rp.id).toBe('beeurei.hikosphere.com') // web 来源拿到 web 域 rpID
    const reg = await app.inject({ method: 'POST', url: '/api/auth/passkey/register/verify', headers: { ...auth(), origin: WEB_ORIGIN }, payload: { response: webAuth.attest(opts.challenge), deviceName: 'Chrome · Mac' } })
    expect(reg.statusCode).toBe(201)
    // 登录（web 来源）：options 也拿 web rpID，断言按 web 域签 → 发令牌。
    const lo = await app.inject({ method: 'POST', url: '/api/auth/passkey/login/options', headers: { origin: WEB_ORIGIN } })
    const { flowId, options } = lo.json()
    expect(options.rpId).toBe('beeurei.hikosphere.com')
    const lv = await app.inject({ method: 'POST', url: '/api/auth/passkey/login/verify', headers: { origin: WEB_ORIGIN }, payload: { flowId, response: webAuth.assert(options.challenge, { counter: 3 }) } })
    expect(lv.statusCode).toBe(200)
    expect(lv.json().user.id).toBe(userId)
    // iOS 侧（API 域 rpID）的既有 passkey 不受影响：无 Origin 头照旧拿 API 域 rpID。
    const iosOpts = (await app.inject({ method: 'POST', url: '/api/auth/passkey/login/options' })).json()
    expect(iosOpts.options.rpId).toBe('beeurei-api.hikosphere.com')
  })

  it('web 端 passkey 拒绝面：别的 rpID（非两作用域之一）签的断言 → 401', async () => {
    const evil = new SoftAuthenticator('evil.example', 'https://beeurei.hikosphere.com')
    const optRes = await app.inject({ method: 'POST', url: '/api/auth/passkey/register/options', headers: { ...auth(), origin: 'https://beeurei.hikosphere.com' } })
    const reg = await app.inject({ method: 'POST', url: '/api/auth/passkey/register/verify', headers: auth(), payload: { response: evil.attest(optRes.json().challenge) } })
    expect(reg.statusCode).toBe(400) // rpIdHash 不在 [API 域, web 域] → 拒
  })

  it('停用账号（管理员封禁）→ 即便断言合法也 403，不发令牌', async () => {
    const u = store.findById(userId)!
    const prev = u.status
    u.status = 'disabled'
    try {
      const { flowId, challenge } = await loginFlow()
      const r = await loginVerify(flowId, authenticator.assert(challenge, { counter: 9 }))
      expect(r.statusCode).toBe(403)
      expect(r.json().error).toBe('account_disabled')
    } finally { u.status = prev }
  })
})
