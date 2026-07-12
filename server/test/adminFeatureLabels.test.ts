import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { FEATURE_KEYS } from '../src/db/store'

/// 约定同步守卫（同 envExample 一族）：FEATURE_KEYS 每加一个功能开关，管理面板中/英 featLabels
/// 都必须补标签——否则开关照常渲染但显示**原始英文键名**（面板 t() 缺键回落），中文运营者不知所云。
/// featuresSchema 已从 FEATURE_KEYS 派生（曾因硬编码漏 locationSharing 无法全站关闭，见 admin.ts），
/// 标签面是同一漂移的另一半，本测锁住。featLabels 允许**多出**的键（emergency/blocks/reports 是
/// "安全功能·始终开启"的锁定展示项，非开关）。
describe('管理面板 featLabels 与 FEATURE_KEYS 同步', () => {
  it('每个功能开关键在中/英 featLabels 都有标签（缺=面板显示原始键名）', () => {
    const src = readFileSync(fileURLToPath(new URL('../public/admin/app.js', import.meta.url)), 'utf8')
    const blocks = [...src.matchAll(/featLabels: \{([^}]*)\}/g)].map((m) => m[1])
    expect(blocks).toHaveLength(2) // 恰中英两份（结构若重构，须同步更新本提取）
    for (const block of blocks) {
      const keys = new Set([...block.matchAll(/([A-Za-z0-9_]+):/g)].map((m) => m[1]))
      const missing = FEATURE_KEYS.filter((k) => !keys.has(k))
      expect(missing).toEqual([]) // 失败即点名漏标签的开关键
    }
  })
})
