import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/// 约定同步守卫（同 adminFeatureLabels 一族）：服务端每新增一个审计动作码（audit(...) 或
/// createAuditEntry({action:'...'})），管理面板中/英 auditActions 都必须补标签——否则审计日志里那条
/// 操作**显示原始动作码**（auditActionName 缺键回落 `|| a`），运营者读不懂"call.observe / kyc.view /
/// recording.delete"到底是谁做了什么。审计=问责，隐私敏感动作（旁观通话/披露实名/查看·删录音）尤须清晰。
/// 本测从源码提取真实动作码、锁住覆盖，杜绝"加了审计却没加标签"的漂移。

function allSrcTsFiles(): string[] {
  const root = fileURLToPath(new URL('../src/', import.meta.url))
  return readdirSync(root, { recursive: true })
    .map((p) => String(p))
    .filter((p) => p.endsWith('.ts') && !p.endsWith('.test.ts') && !p.endsWith('.d.ts'))
    .map((p) => `${root}${p}`)
}

/// 服务端源码里实际发出的所有审计动作码（两种写法：audit() 帮手位置参数 + 直呼 createAuditEntry 的 action 字面量）。
function serverAuditCodes(): Set<string> {
  const codes = new Set<string>()
  const codeRe = "([a-z][a-z_]*\\.[a-z_.]+)"
  const auditHelper = new RegExp("\\baudit\\(\\s*[^,]+,\\s*'" + codeRe + "'", 'g')
  const direct = new RegExp("createAuditEntry\\(\\s*\\{[^}]*?action:\\s*'" + codeRe + "'", 'g')
  for (const file of allSrcTsFiles()) {
    const t = readFileSync(file, 'utf8')
    for (const m of t.matchAll(auditHelper)) codes.add(m[1])
    for (const m of t.matchAll(direct)) codes.add(m[1])
  }
  return codes
}

describe('管理面板 auditActions 覆盖所有服务端审计动作码', () => {
  it('每个 audit()/createAuditEntry 的 action 在中/英 auditActions 都有标签（缺=审计日志显示原始码）', () => {
    const codes = serverAuditCodes()
    // sanity：确实扫到了动作码（正则/路径若失效应在此暴露，而非静默通过空集）。
    expect(codes.size).toBeGreaterThan(8)
    expect(codes.has('kyc.view')).toBe(true)
    expect(codes.has('recording.delete')).toBe(true)

    const appjs = readFileSync(fileURLToPath(new URL('../public/admin/app.js', import.meta.url)), 'utf8')
    const blocks = [...appjs.matchAll(/auditActions: \{([^}]*)\}/g)].map((m) => m[1])
    expect(blocks).toHaveLength(2) // 恰中英两份（结构若重构，须同步更新本提取）
    for (const block of blocks) {
      const keys = new Set([...block.matchAll(/'([a-z][a-z_]*\.[a-z_.]+)':/g)].map((m) => m[1]))
      const missing = [...codes].filter((c) => !keys.has(c)).sort()
      expect(missing).toEqual([]) // 失败即点名漏标签的审计动作码
    }
  })
})
