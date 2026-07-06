import { mkdirSync, rmSync, existsSync } from 'node:fs'
import { readFile, writeFile } from 'node:fs/promises'
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

// 异步读写（非 *Sync）：证件密文单文件最大 8MB、每次提交 2~3 张，同步写会阻塞事件循环卡住全服务
// （含紧急呼叫）——与 media 落盘同治。await 由调用方保证顺序（写完再登记 ref / 读到再解密）。
export async function writeKycBlob(id: string, ciphertext: Buffer): Promise<void> {
  await writeFile(kycBlobPath(id), ciphertext, { mode: 0o600 })
}

export async function readKycBlob(id: string): Promise<Buffer> {
  return readFile(kycBlobPath(id))
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
