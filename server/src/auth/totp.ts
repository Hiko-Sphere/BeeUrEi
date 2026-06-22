import { createHmac, createHash, randomBytes, timingSafeEqual } from 'node:crypto'

/// 两步验证（2FA）：基于时间的一次性口令 TOTP（RFC 6238, HMAC-SHA1, 30s, 6 位）+ 一次性恢复码。
/// 纯 node:crypto 实现，无第三方依赖。所有时间通过参数传入，便于测试与时钟注入。

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567' // RFC 4648 base32 字母表

export function base32Encode(buf: Buffer): string {
  let bits = 0, value = 0, out = ''
  for (const b of buf) {
    value = (value << 8) | b; bits += 8
    while (bits >= 5) { out += B32[(value >>> (bits - 5)) & 31]; bits -= 5 }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31]
  return out
}

export function base32Decode(s: string): Buffer {
  const clean = s.toUpperCase().replace(/[^A-Z2-7]/g, '')
  let bits = 0, value = 0
  const out: number[] = []
  for (const c of clean) {
    value = (value << 5) | B32.indexOf(c); bits += 5
    if (bits >= 8) { out.push((value >>> (bits - 8)) & 0xff); bits -= 8 }
  }
  return Buffer.from(out)
}

/// 生成新的 TOTP 密钥（base32，默认 160 bit，符合 RFC 4226 推荐）。
export function generateTotpSecret(bytes = 20): string {
  return base32Encode(randomBytes(bytes))
}

/// 计算某时刻的 6 位 TOTP。
export function totpAt(secretB32: string, timeMs: number, step = 30, digits = 6): string {
  const counter = Math.floor(timeMs / 1000 / step)
  const buf = Buffer.alloc(8)
  buf.writeBigUInt64BE(BigInt(counter))
  const hmac = createHmac('sha1', base32Decode(secretB32)).update(buf).digest()
  const offset = hmac[hmac.length - 1] & 0x0f
  const bin = ((hmac[offset] & 0x7f) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3]
  return (bin % 10 ** digits).toString().padStart(digits, '0')
}

/// 校验 TOTP：允许 ±window 个时间步（默认 ±1，容忍最多 30s 时钟漂移）。常数时间比较防计时侧信道。
export function verifyTotp(secretB32: string, code: string, timeMs: number, window = 1): boolean {
  const clean = (code ?? '').replace(/\s/g, '')
  if (!/^\d{6}$/.test(clean)) return false
  for (let w = -window; w <= window; w++) {
    const expected = totpAt(secretB32, timeMs + w * 30_000)
    if (timingSafeEqual(Buffer.from(expected), Buffer.from(clean))) return true
  }
  return false
}

/// otpauth:// URI（供验证器 App 扫码或点链接添加；盲人也可直接复制密钥手动添加）。
export function otpauthURI(secretB32: string, account: string, issuer = 'BeeUrEi'): string {
  const label = encodeURIComponent(`${issuer}:${account}`)
  const params = new URLSearchParams({ secret: secretB32, issuer, algorithm: 'SHA1', digits: '6', period: '30' })
  return `otpauth://totp/${label}?${params.toString()}`
}

// MARK: 恢复码（一次性，丢失验证器时用）

/// 生成 n 个高熵恢复码（每个 10 位 base32，形如 ABCDE-FGHIJ）。明文只展示一次，库里只存哈希。
export function generateRecoveryCodes(n = 10): string[] {
  const codes: string[] = []
  for (let i = 0; i < n; i++) {
    const raw = base32Encode(randomBytes(8)).slice(0, 10)
    codes.push(`${raw.slice(0, 5)}-${raw.slice(5, 10)}`)
  }
  return codes
}

/// 归一化恢复码（大小写不敏感、忽略连字符/空格）后取 SHA-256 哈希入库/比对。
export function hashRecoveryCode(code: string): string {
  const norm = (code ?? '').toUpperCase().replace(/[^A-Z2-7]/g, '')
  return createHash('sha256').update(norm).digest('hex')
}
