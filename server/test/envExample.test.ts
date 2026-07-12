import { describe, it, expect } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/// 配置可发现性守卫：src 里读到的每个 process.env.X 都必须出现在 .env.example——否则运营者
/// 无从得知该开关存在（留存期/阈值/法律版本这类**改变产品行为**的配置尤甚）。曾漂移出 8 个
/// 未记载变量（AMAP 熔断/两个留存期/危急电量/LEGAL_VERSION 等），本测锁住不再回潮。
const root = fileURLToPath(new URL('..', import.meta.url))

function codeEnvVars(): Set<string> {
  const vars = new Set<string>()
  for (const ent of readdirSync(join(root, 'src'), { recursive: true, withFileTypes: true })) {
    if (!ent.isFile() || !ent.name.endsWith('.ts')) continue
    const dir = (ent as unknown as { parentPath?: string; path?: string })
    const text = readFileSync(join(dir.parentPath ?? dir.path ?? join(root, 'src'), ent.name), 'utf8')
    for (const m of text.matchAll(/process\.env\.([A-Z0-9_]+)/g)) vars.add(m[1])
  }
  return vars
}

describe('.env.example 完备性', () => {
  it('src 读取的每个 process.env.X 都记载于 .env.example（含默认值/语义说明）', () => {
    const example = readFileSync(join(root, '.env.example'), 'utf8')
    const missing = [...codeEnvVars()].filter((v) => !example.includes(v)).sort()
    // 失败信息直接给出漏了谁——补一行带默认值与说明的条目即可转绿。
    expect(missing).toEqual([])
  })
})
