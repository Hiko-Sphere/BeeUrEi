import axe from 'axe-core'

/// 共享 axe 无障碍检查（供 a11y 回归门禁与各页面测试复用）。返回违规摘要列表（空=通过）。
/// jsdom 限制：color-contrast 需真实排版（对比度已人工审计 + 主题 token 锁定）；region/landmark 针对整页
/// （页面片段单渲时地标由 Layout 提供）——两者禁用；其余规则（label/button-name/aria-*/list 结构等）在 jsdom 下有效。
export async function axeViolations(container: Element): Promise<{ rule: string; help: string; nodes: string[] }[]> {
  const results = await axe.run(container, {
    rules: {
      'color-contrast': { enabled: false },
      region: { enabled: false },
    },
  })
  return results.violations.map((v) => ({ rule: v.id, help: v.help, nodes: v.nodes.map((n) => n.target.join(' ')) }))
}
