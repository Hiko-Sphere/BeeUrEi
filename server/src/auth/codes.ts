import { createHash, randomInt } from 'node:crypto'

/// 短时效验证码登记表（内存；纯逻辑可单测）。用于邮箱验证与找回密码（D1）。
/// 只存码的哈希、限定尝试次数与有效期，过期/超限即作废——防暴力猜码。
/// 内存实现可接受：码寿命仅 10 分钟，服务重启使待验证码失效属合理安全行为。
export interface CodeEntry {
  codeHash: string
  expiresAt: number
  attempts: number
}

export class CodeRegistry {
  private map = new Map<string, CodeEntry>()

  constructor(
    private readonly ttlMs = 10 * 60 * 1000,
    private readonly maxAttempts = 5,
  ) {}

  private hash(code: string): string {
    return createHash('sha256').update(code).digest('hex')
  }

  /// 生成并存储一个 6 位数字码（覆盖该 key 的旧码），返回明文供邮件发送。
  /// 测试可传入固定 code 以确定性断言。
  issue(key: string, now: number, code?: string): string {
    const c = code ?? String(randomInt(0, 1_000_000)).padStart(6, '0')
    this.map.set(key, { codeHash: this.hash(c), expiresAt: now + this.ttlMs, attempts: 0 })
    return c
  }

  /// 校验：成功则消费（删除）返回 true；失败累计 attempts，过期或超限即删除。
  verify(key: string, code: string, now: number): boolean {
    const e = this.map.get(key)
    if (!e) return false
    if (now > e.expiresAt) {
      this.map.delete(key)
      return false
    }
    if (e.attempts >= this.maxAttempts) {
      this.map.delete(key)
      return false
    }
    if (e.codeHash !== this.hash(code)) {
      e.attempts++
      return false
    }
    this.map.delete(key)
    return true
  }

  /// 校验但**不消费**：用于"第一因子(邮箱码)已对，但还需第二因子(2FA)才放行"的场景，
  /// 避免 2FA 未过时把邮箱码提前作废、导致补交验证码后无法重试。匹配失败仍计入尝试次数（防暴破）。
  peek(key: string, code: string, now: number): boolean {
    const e = this.map.get(key)
    if (!e) return false
    if (now > e.expiresAt) { this.map.delete(key); return false }
    if (e.attempts >= this.maxAttempts) { this.map.delete(key); return false }
    if (e.codeHash !== this.hash(code)) { e.attempts++; return false }
    return true // 命中但不删除
  }

  has(key: string): boolean {
    return this.map.has(key)
  }

  get size(): number {
    return this.map.size
  }
}
