import { readFileSync } from 'node:fs'

/// 版本信息单一真相（/api/version 与 /api/admin/overview 共用）：
/// version 读自 package.json；commit 由 Docker build-arg 注入 GIT_SHA（未注入=本地开发 → 'unknown'）。
export const PKG_VERSION: string = (() => {
  try {
    return (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { version?: string }).version ?? '0.0.0'
  } catch { return '0.0.0' } // 读不到绝不崩——版本探针不影响服务可用性
})()

export function gitCommit(): string {
  return process.env.GIT_SHA?.trim() || 'unknown'
}
