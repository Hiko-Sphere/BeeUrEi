import { mkdirSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'

/// KYC 证件密文磁盘存储——与通用 media/storage.ts 刻意隔离：
///   · 独立目录 KYC_DIR（默认 data/kyc，权限 0700，仅服务进程可读写）；
///   · 文件以服务端 UUID 为名（无扩展名、不接受外部输入拼路径）；
///   · 绝不登记进 media 表、绝不经 /api/media 提供——只有 admin 路由解密读取。
/// 落盘的是 AES-256-GCM 密文（kyc/crypto.ts seal()），磁盘单独泄露不可解密。

export function kycDir(): string {
  return process.env.KYC_DIR?.trim() || 'data/kyc'
}

export function kycBlobPath(id: string): string {
  return join(kycDir(), id)
}

export function ensureKycDir(): void {
  mkdirSync(kycDir(), { recursive: true, mode: 0o700 })
}

export function writeKycBlob(id: string, ciphertext: Buffer): void {
  writeFileSync(kycBlobPath(id), ciphertext, { mode: 0o600 })
}

export function readKycBlob(id: string): Buffer {
  return readFileSync(kycBlobPath(id))
}

export function kycBlobExists(id: string): boolean {
  return existsSync(kycBlobPath(id))
}

export function removeKycBlob(id: string): void {
  try {
    rmSync(kycBlobPath(id))
  } catch {
    /* 文件不存在/已删——幂等 */
  }
}
