import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

/// KYC 信封加密（AES-256-GCM）。
///
/// 威胁模型：实名/证件是最敏感的 PII。设计目标——单一介质泄露不可解密：
///   · 密文（证件图片）只落在隔离的 KYC_DIR 磁盘（kyc/storage.ts），绝不进 media 表/通用下载；
///   · 每条记录一把随机 256-bit DEK，DEK 用主密钥 KYC_ENC_KEY 包裹后存库（store.Sealed.wrappedDek）；
///   · 还原明文需「磁盘密文 + 库中 wrappedDek + 主密钥」三者同时具备。
/// 主密钥独立于 JWT_SECRET（职责分离）：JWT 泄露可伪造令牌，但绝不能顺带解密每一本护照。
/// 信封方案让主密钥轮换只需重新包裹 DEK，无需重新加密数 MB 的图片。
/// fail-closed：缺失/格式错/与 JWT_SECRET 相同即拒绝启动（与 tokens.ts 同纪律）。

const MASTER_KEY_ID = 'k1'

const raw = process.env.KYC_ENC_KEY
  ?? (process.env.NODE_ENV === 'test' ? 'a'.repeat(64) : '') // 仅测试用确定性 32 字节密钥，对齐 tokens.ts 的 test 兜底
if (!/^[0-9a-fA-F]{64}$/.test(raw)) {
  throw new Error('KYC_ENC_KEY 未配置或格式错误：必须为 64 位十六进制（openssl rand -hex 32 生成 32 字节密钥）')
}
if (process.env.JWT_SECRET && raw.toLowerCase() === process.env.JWT_SECRET.toLowerCase()) {
  throw new Error('KYC_ENC_KEY 不得与 JWT_SECRET 相同：密钥职责必须分离，否则令牌密钥泄露即可解密全部证件')
}
const MASTER = Buffer.from(raw, 'hex') // 32 字节

/// 信封：随机数据密钥（DEK）+ 用主密钥包裹的 DEK + 密文的 IV/认证标签。
/// 存于库中（小字段 ct 内联；图片密文落盘，ct 留空）。
export interface Sealed {
  keyId: string // 'k1'——哪一把主密钥包裹了 DEK（为将来轮换保留）
  wrappedDek: string // base64( iv(12) | tag(16) | wrappedDEK )
  iv: string // base64，正文 12 字节 IV
  tag: string // base64，正文 16 字节 GCM 认证标签
  ct?: string // base64 密文——仅小字段（姓名/证件号）内联；图片把密文写盘，此处留空
}

/// AAD 把密文绑定到 {submissionId|kind|keyId}——一段密文无法被挪用/替换到别的记录或字段。
function aadBuf(aad: { submissionId: string; kind: string }, keyId: string): Buffer {
  return Buffer.from(`${aad.submissionId}|${aad.kind}|${keyId}`)
}

// 包裹层也绑定同一 AAD（纵深防御）：单靠正文 GCM 的 AAD 之外，wrappedDek 本身也拒绝被挪到别的记录/字段，
// 不依赖"解密方一定用本记录自身 id"这一调用约定。
function wrapDek(dek: Buffer, aad: { submissionId: string; kind: string }): string {
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', MASTER, iv)
  c.setAAD(aadBuf(aad, MASTER_KEY_ID))
  const ct = Buffer.concat([c.update(dek), c.final()])
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64')
}

function unwrapDek(wrapped: string, aad: { submissionId: string; kind: string }, keyId: string): Buffer {
  const b = Buffer.from(wrapped, 'base64')
  const d = createDecipheriv('aes-256-gcm', MASTER, b.subarray(0, 12))
  d.setAAD(aadBuf(aad, keyId))
  d.setAuthTag(b.subarray(12, 28))
  return Buffer.concat([d.update(b.subarray(28)), d.final()])
}

/// 加密任意字节（用于图片）：返回库中信封 + 落盘密文。
export function seal(
  plain: Buffer,
  aad: { submissionId: string; kind: string },
): { sealed: Sealed; ciphertext: Buffer } {
  const dek = randomBytes(32)
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', dek, iv)
  c.setAAD(aadBuf(aad, MASTER_KEY_ID))
  const ciphertext = Buffer.concat([c.update(plain), c.final()])
  const tag = c.getAuthTag()
  const sealed: Sealed = {
    keyId: MASTER_KEY_ID,
    wrappedDek: wrapDek(dek, aad),
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
  }
  dek.fill(0)
  return { sealed, ciphertext }
}

/// 解密任意字节（用于图片）：密文来自磁盘。
export function open(
  sealed: Sealed,
  ciphertext: Buffer,
  aad: { submissionId: string; kind: string },
): Buffer {
  const dek = unwrapDek(sealed.wrappedDek, aad, sealed.keyId)
  const d = createDecipheriv('aes-256-gcm', dek, Buffer.from(sealed.iv, 'base64'))
  d.setAAD(aadBuf(aad, sealed.keyId))
  d.setAuthTag(Buffer.from(sealed.tag, 'base64'))
  const out = Buffer.concat([d.update(ciphertext), d.final()])
  dek.fill(0)
  return out
}

/// 小字段便捷封装（姓名/证件号）：密文内联进 Sealed.ct，不落盘。
export function sealField(plain: string, aad: { submissionId: string; kind: string }): Sealed {
  const { sealed, ciphertext } = seal(Buffer.from(plain, 'utf8'), aad)
  return { ...sealed, ct: ciphertext.toString('base64') }
}

export function openField(sealed: Sealed, aad: { submissionId: string; kind: string }): string {
  if (!sealed.ct) throw new Error('sealed field has no inline ciphertext')
  return open(sealed, Buffer.from(sealed.ct, 'base64'), aad).toString('utf8')
}
