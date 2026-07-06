import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

/// 管理面板是无构建的 vanilla JS（public/admin/app.js），此前无任何可执行测试。用 node:vm 加载：
/// 顶层 const（state/I18N）不会挂到 vm 全局，故在 bootstrap render() 之前注入同脚本导出（replace 锚点
/// 不命中则显式抛错，绝不静默空测）；render() 需要真实 DOM，用最小 stub + try/catch 兜底（导出已先执行）。
function loadSpa(): { state: { lang: string; emergencies: unknown[] }; t: (k: string) => string; emergencySection: () => string } {
  const path = fileURLToPath(new URL('../public/admin/app.js', import.meta.url))
  let src = readFileSync(path, 'utf8')
  const anchor = '\nrender();'
  if (!src.includes(anchor)) throw new Error('app.js bootstrap anchor "render();" not found — update test')
  src = src.replace(anchor, '\nglobalThis.__test = { state, t, emergencySection };\nrender();')
  const noop = (): void => {}
  const classList = { add: noop, remove: noop, toggle: noop, contains: () => false }
  const ctx: Record<string, unknown> = {
    localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
    navigator: { language: 'zh-CN' },
    window: { addEventListener: noop, matchMedia: () => ({ matches: false, addEventListener: noop }) },
    document: {
      documentElement: { lang: '', dataset: {}, classList },
      body: { classList, dataset: {} },
      getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
      addEventListener: noop, createElement: () => ({ style: {}, classList, dataset: {} }),
    },
    location: { hash: '' }, history: { replaceState: noop },
    fetch: () => new Promise(noop), setTimeout, clearTimeout, setInterval, clearInterval, console, URLSearchParams,
  }
  ctx.globalThis = ctx
  vm.createContext(ctx as vm.Context)
  try { vm.runInContext(src, ctx as vm.Context) } catch { /* bootstrap render() 需真实 DOM；导出行在其前已执行 */ }
  const test = (ctx as { __test?: ReturnType<typeof loadSpa> }).__test
  if (!test) throw new Error('__test export missing — app.js failed before export line')
  return test
}

const ev = (over: Record<string, unknown>) => ({
  id: 'e1', userId: 'u1', kind: 'fall', notified: 1, contacts: 2, at: 1_700_000_000_000,
  userName: '小明', username: 'xiaoming', ...over,
})

describe('管理面板 紧急事件区（响应结果分诊信号）', () => {
  it('kind=checkin 有本地化标签（此前 t() 缺键回落显示原始 "emergKind_checkin"）', () => {
    const spa = loadSpa()
    spa.state.lang = 'zh'
    spa.state.emergencies = [ev({ kind: 'checkin' })]
    const html = spa.emergencySection()
    expect(html).toContain('安全报到未报平安')
    expect(html).not.toContain('emergKind_checkin') // 缺键时 t() 会回落 key 本身直接显示——不允许
  })

  it('ackedAt 有值 → "有人响应"绿标；且不出现"无人响应"红标', () => {
    const spa = loadSpa()
    spa.state.lang = 'zh'
    spa.state.emergencies = [ev({ ackedAt: 1_700_000_100_000, escalatedAt: 1_700_000_050_000 })]
    const html = spa.emergencySection()
    expect(html).toContain('有人响应')
    expect(html).not.toContain('升级后仍无人响应') // 已有人响应，即使升级过也不是"无人管"
  })

  it('升级重呼后仍无人响应（未 ack + 已 escalate + 未解除）→ 红标（最需人工介入的状态）', () => {
    const spa = loadSpa()
    spa.state.lang = 'zh'
    spa.state.emergencies = [ev({ escalatedAt: 1_700_000_050_000 })] // 无 ackedAt/resolvedAt
    const html = spa.emergencySection()
    expect(html).toContain('升级后仍无人响应')
    expect(html).not.toContain('有人响应')
  })

  it('已报平安（resolvedAt）→ 即使升级过也不再标"无人响应"（已解除，非待介入）', () => {
    const spa = loadSpa()
    spa.state.lang = 'zh'
    spa.state.emergencies = [ev({ escalatedAt: 1_700_000_050_000, resolvedAt: 1_700_000_200_000 })]
    const html = spa.emergencySection()
    expect(html).toContain('已报平安')
    expect(html).not.toContain('升级后仍无人响应')
  })
})
