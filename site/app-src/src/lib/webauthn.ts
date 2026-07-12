/// WebAuthn 浏览器桥接：服务端（@simplewebauthn）吐/收的都是 base64url JSON，浏览器
/// navigator.credentials 要 ArrayBuffer——这里做双向转换。新浏览器（Chrome 129+/Safari 18+）
/// 直接用平台原生的 parseCreationOptionsFromJSON/toJSON；老浏览器走手写转换兜底。
/// 零依赖（不引 @simplewebauthn/browser）：面积小、CSP 干净、行为可审计。

export const passkeySupported = (): boolean =>
  typeof window !== 'undefined' && 'PublicKeyCredential' in window && !!navigator.credentials

const b64uToBuf = (s: string): Uint8Array =>
  Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0))
const bufToB64u = (b: ArrayBuffer): string =>
  btoa(String.fromCharCode(...new Uint8Array(b))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

/* eslint-disable @typescript-eslint/no-explicit-any -- WebAuthn options 形状由服务端 @simplewebauthn 定义，双向透传 */
type PKC = PublicKeyCredential & {
  response: AuthenticatorAttestationResponse & AuthenticatorAssertionResponse & { getTransports?: () => string[] }
  toJSON?: () => unknown
}
const PKCStatic = () => PublicKeyCredential as unknown as {
  parseCreationOptionsFromJSON?: (o: unknown) => CredentialCreationOptions['publicKey']
  parseRequestOptionsFromJSON?: (o: unknown) => CredentialRequestOptions['publicKey']
}

/// 注册：服务端 options JSON → 浏览器创建凭据 → 回服务端可验的 JSON。
export async function createPasskey(optionsJSON: any): Promise<unknown> {
  let publicKey: CredentialCreationOptions['publicKey']
  const native = PKCStatic().parseCreationOptionsFromJSON
  if (native) publicKey = native(optionsJSON)
  else {
    publicKey = {
      ...optionsJSON,
      challenge: b64uToBuf(optionsJSON.challenge),
      user: { ...optionsJSON.user, id: b64uToBuf(optionsJSON.user.id) },
      excludeCredentials: (optionsJSON.excludeCredentials ?? []).map((c: any) => ({ ...c, id: b64uToBuf(c.id) })),
    }
  }
  const cred = (await navigator.credentials.create({ publicKey })) as PKC | null
  if (!cred) throw new Error('passkey_create_cancelled')
  if (cred.toJSON) return cred.toJSON()
  return {
    id: cred.id,
    rawId: bufToB64u(cred.rawId),
    type: cred.type,
    clientExtensionResults: cred.getClientExtensionResults(),
    authenticatorAttachment: (cred as any).authenticatorAttachment ?? undefined,
    response: {
      clientDataJSON: bufToB64u(cred.response.clientDataJSON),
      attestationObject: bufToB64u(cred.response.attestationObject),
      transports: cred.response.getTransports?.() ?? [],
    },
  }
}

/// 登录：服务端 options JSON → 浏览器出断言 → 回服务端可验的 JSON。
export async function getPasskey(optionsJSON: any): Promise<unknown> {
  let publicKey: CredentialRequestOptions['publicKey']
  const native = PKCStatic().parseRequestOptionsFromJSON
  if (native) publicKey = native(optionsJSON)
  else {
    publicKey = {
      ...optionsJSON,
      challenge: b64uToBuf(optionsJSON.challenge),
      allowCredentials: (optionsJSON.allowCredentials ?? []).map((c: any) => ({ ...c, id: b64uToBuf(c.id) })),
    }
  }
  const cred = (await navigator.credentials.get({ publicKey })) as PKC | null
  if (!cred) throw new Error('passkey_get_cancelled')
  if (cred.toJSON) return cred.toJSON()
  return {
    id: cred.id,
    rawId: bufToB64u(cred.rawId),
    type: cred.type,
    clientExtensionResults: cred.getClientExtensionResults(),
    response: {
      clientDataJSON: bufToB64u(cred.response.clientDataJSON),
      authenticatorData: bufToB64u(cred.response.authenticatorData),
      signature: bufToB64u(cred.response.signature),
      userHandle: cred.response.userHandle ? bufToB64u(cred.response.userHandle) : undefined,
    },
  }
}
