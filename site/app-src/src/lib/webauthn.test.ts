// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createPasskey, getPasskey, passkeySupported } from './webauthn'

/// WebAuthn 桥接的变换数学：服务端 base64url JSON ↔ 浏览器 ArrayBuffer 双向转换。
/// jsdom 无 parseCreationOptionsFromJSON → 恰好走**手写兜底路径**（老浏览器同款），
/// 用真 ArrayBuffer 往返验证：转错一个字节，真机上的表现就是"添加失败"且无从排查。
const enc = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0))
const b64u = (s: string) => btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

let created: CredentialCreationOptions | null = null
let requested: CredentialRequestOptions | null = null
const fakeCred = {
  id: 'cred-id-b64u',
  rawId: enc('RAWID').buffer,
  type: 'public-key',
  getClientExtensionResults: () => ({}),
  response: {
    clientDataJSON: enc('{"type":"webauthn.create"}').buffer,
    attestationObject: enc('ATTOBJ').buffer,
    authenticatorData: enc('AUTHDATA').buffer,
    signature: enc('SIG').buffer,
    userHandle: enc('UID').buffer,
    getTransports: () => ['internal'],
  },
}

beforeEach(() => {
  created = null; requested = null
  Object.defineProperty(window, 'PublicKeyCredential', { value: function () {}, configurable: true })
  Object.defineProperty(navigator, 'credentials', {
    configurable: true,
    value: {
      create: vi.fn(async (o: CredentialCreationOptions) => { created = o; return fakeCred }),
      get: vi.fn(async (o: CredentialRequestOptions) => { requested = o; return fakeCred }),
    },
  })
})
afterEach(() => { vi.restoreAllMocks() })

describe('webauthn 桥接（手写兜底路径）', () => {
  it('createPasskey：challenge/user.id/excludeCredentials 转成字节；响应各字段转回 base64url', async () => {
    const out = await createPasskey({
      challenge: b64u('CHAL'), rp: { id: 'beeurei.hikosphere.com', name: 'BeeUrEi' },
      user: { id: b64u('user-1'), name: 'u', displayName: 'U' },
      excludeCredentials: [{ id: b64u('EXCL'), type: 'public-key' }],
      pubKeyCredParams: [{ alg: -7, type: 'public-key' }],
    }) as Record<string, never>
    const pk = created!.publicKey!
    expect(new TextDecoder().decode(pk.challenge as ArrayBuffer)).toBe('CHAL')
    expect(new TextDecoder().decode(pk.user.id as ArrayBuffer)).toBe('user-1')
    expect(new TextDecoder().decode(pk.excludeCredentials![0].id as ArrayBuffer)).toBe('EXCL')
    expect(out).toMatchObject({
      id: 'cred-id-b64u', rawId: b64u('RAWID'), type: 'public-key',
      response: { clientDataJSON: b64u('{"type":"webauthn.create"}'), attestationObject: b64u('ATTOBJ'), transports: ['internal'] },
    })
  })

  it('getPasskey：allowCredentials 转字节；断言字段（authenticatorData/signature/userHandle）转回 base64url', async () => {
    const out = await getPasskey({
      challenge: b64u('CHAL2'), rpId: 'beeurei.hikosphere.com',
      allowCredentials: [{ id: b64u('ALLOW'), type: 'public-key' }],
    }) as Record<string, never>
    const pk = requested!.publicKey!
    expect(new TextDecoder().decode(pk.challenge as ArrayBuffer)).toBe('CHAL2')
    expect(new TextDecoder().decode(pk.allowCredentials![0].id as ArrayBuffer)).toBe('ALLOW')
    expect(out).toMatchObject({
      rawId: b64u('RAWID'),
      response: { authenticatorData: b64u('AUTHDATA'), signature: b64u('SIG'), userHandle: b64u('UID') },
    })
  })

  it('base64url 特有字符（-/_、无填充）解码正确——标准 atob 直接吃会炸的形状', async () => {
    // 0xfb 0xef 0xbe → base64 "++++"→ b64u "----"；确保 -/_ 替换与补位都对。
    const bytes = new Uint8Array([0xfb, 0xef, 0xbe])
    const b64uStr = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
    await getPasskey({ challenge: b64uStr, allowCredentials: [] })
    expect([...new Uint8Array(requested!.publicKey!.challenge as ArrayBuffer)]).toEqual([0xfb, 0xef, 0xbe])
  })

  it('用户取消（create/get 返回 null）→ 抛错（调用方按取消静默处理）；支持性探测如实', async () => {
    ;(navigator.credentials.create as ReturnType<typeof vi.fn>).mockResolvedValue(null)
    await expect(createPasskey({ challenge: b64u('X'), user: { id: b64u('u') } })).rejects.toThrow('passkey_create_cancelled')
    expect(passkeySupported()).toBe(true)
    Object.defineProperty(window, 'PublicKeyCredential', { value: undefined, configurable: true })
    // @ts-expect-error 探测负例
    delete window.PublicKeyCredential
    expect(passkeySupported()).toBe(false)
  })
})
