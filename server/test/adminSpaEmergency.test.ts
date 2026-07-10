import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

/// 管理面板是无构建的 vanilla JS（public/admin/app.js），此前无任何可执行测试。用 node:vm 加载：
/// 顶层 const（state/I18N）不会挂到 vm 全局，故在 bootstrap render() 之前注入同脚本导出（replace 锚点
/// 不命中则显式抛错，绝不静默空测）；DOM 用**宽容自引用 stub 元素**（getElementById/querySelector 都回它，
/// innerHTML 可读写）——渲染函数写完 innerHTML 后测试读回断言，事件绑定全 noop。
interface SpaTest {
  state: { lang: string; emergencies: unknown[]; calls: unknown[]; callsQuery: string; overview: unknown }
  t: (k: string) => string
  emergencySection: () => string
  renderCalls: () => void
  renderDashboard: () => void
  view: { innerHTML: string } // 渲染函数写入的共享 stub 元素（viewEl()/$ 都解析到它）
}
function loadSpa(): SpaTest {
  const path = fileURLToPath(new URL('../public/admin/app.js', import.meta.url))
  let src = readFileSync(path, 'utf8')
  const anchor = '\nrender();'
  if (!src.includes(anchor)) throw new Error('app.js bootstrap anchor "render();" not found — update test')
  src = src.replace(anchor, '\nglobalThis.__test = { state, t, emergencySection, renderCalls, renderDashboard };\nrender();')
  const noop = (): void => {}
  const classList = { add: noop, remove: noop, toggle: noop, contains: () => false }
  // 自引用宽容元素：querySelector 返回自身（事件绑定链不断）、querySelectorAll 空数组、其余 noop。
  const stubEl: Record<string, unknown> = { innerHTML: '', value: '', dataset: {}, style: {}, classList, addEventListener: noop, focus: noop }
  stubEl.querySelector = () => stubEl
  stubEl.querySelectorAll = () => []
  const ctx: Record<string, unknown> = {
    localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
    navigator: { language: 'zh-CN' },
    window: { addEventListener: noop, matchMedia: () => ({ matches: false, addEventListener: noop }) },
    document: {
      documentElement: { lang: '', dataset: {}, classList },
      body: { classList, dataset: {} },
      getElementById: () => stubEl, querySelector: () => stubEl, querySelectorAll: () => [],
      addEventListener: noop, createElement: () => ({ style: {}, classList, dataset: {} }),
    },
    location: { hash: '' }, history: { replaceState: noop },
    fetch: () => new Promise(noop), setTimeout, clearTimeout, setInterval, clearInterval, console, URLSearchParams,
  }
  ctx.globalThis = ctx
  vm.createContext(ctx as vm.Context)
  try { vm.runInContext(src, ctx as vm.Context) } catch { /* bootstrap render() 若仍缺环境；导出行在其前已执行 */ }
  const test = (ctx as { __test?: Omit<SpaTest, 'view'> }).__test
  if (!test) throw new Error('__test export missing — app.js failed before export line')
  return { ...test, view: stubEl as { innerHTML: string } }
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

  it('触达=0（notified===0 且未解除）→ danger 红标"未触达任何人"（求助连一人都没送出，最危急）', () => {
    const spa = loadSpa()
    spa.state.lang = 'zh'
    spa.state.emergencies = [ev({ notified: 0, contacts: 2 })] // 有 2 位亲友但一个都没即时推送到
    const html = spa.emergencySection()
    expect(html).toContain('未触达任何人')
    expect(html).toMatch(/pill danger">⚠️ 未触达任何人/)
  })

  it('触达>0 → 不标"未触达"；已报平安即使当时触达0也不再红标（已解除，非待介入）', () => {
    const spa = loadSpa()
    spa.state.lang = 'zh'
    spa.state.emergencies = [ev({ notified: 1, contacts: 2 })]
    expect(spa.emergencySection()).not.toContain('未触达任何人')
    spa.state.emergencies = [ev({ notified: 0, contacts: 2, resolvedAt: 1_700_000_200_000 })]
    expect(spa.emergencySection()).not.toContain('未触达任何人') // 已报平安，不再列为待介入
  })

  it('渲染全部取到的事件（标题称"近 100 条"就真给 100 条）：第 21+ 位的"无人响应"红标不被截掉（复审 CONFIRMED）', () => {
    const spa = loadSpa()
    spa.state.lang = 'zh'
    // 20 条较新的普通事件在前 + 第 25 位是升级后仍无人响应的待介入事件（时间更早=列表更后）。
    spa.state.emergencies = [
      ...Array.from({ length: 24 }, (_, i) => ev({ id: `e${i}`, userName: `路人${i}`, resolvedAt: 1_700_000_300_000 })),
      ev({ id: 'stuck', userName: '被截者', escalatedAt: 1_700_000_050_000 }), // 未 ack、未解除
    ]
    const html = spa.emergencySection()
    expect(html.split('bar-row').length - 1).toBe(25)   // 25 条全渲染（此前 slice(0,20) 只剩 20）
    expect(html).toContain('被截者')                     // 第 25 位仍可见
    expect(html).toContain('升级后仍无人响应')            // 待介入红标不被静默截掉
  })
})

describe('管理面板 总览「通话中继失败」卡（运维可见 TURN 故障）', () => {
  const overview = (over: Record<string, unknown> = {}) => ({
    users: { total: 1, active: 1, disabled: 0, byRole: { blind: 1, helper: 0, family: 0, admin: 0, developer: 0 } },
    online: { total: 0, helpers: 0 }, reports: { open: 0, total: 0 },
    recordings: { total: 0, config: {} }, verifications: { pending: 0, total: 0 },
    growth: { newUsers7d: 0, newUsers30d: 0, trend: [] }, version: '0.1.0', commit: 'unknown', ...over,
  })

  it('relayUnreachable>0 → 渲染卡片、danger 色、附 TURN/3478 提示', () => {
    const spa = loadSpa()
    spa.state.lang = 'zh'
    spa.state.overview = overview({ callConnect: { relayUnreachable: 3, generic: 1, signaling: 2 } })
    spa.renderDashboard()
    const html = spa.view.innerHTML
    expect(html).toContain('通话中继失败')
    expect(html).toContain('>3<')                 // relayUnreachable 主数
    expect(html).toContain('TURN')                // 提示指向根因
    expect(html).toMatch(/class="v danger"[^>]*>\s*3/) // danger 色（有失败）
  })

  it('relayUnreachable=0 → 卡片仍渲染但不加 danger、不附提示（不误报）', () => {
    const spa = loadSpa()
    spa.state.lang = 'zh'
    spa.state.overview = overview({ callConnect: { relayUnreachable: 0, generic: 0, signaling: 0 } })
    spa.renderDashboard()
    const html = spa.view.innerHTML
    expect(html).toContain('通话中继失败')
    expect(html).not.toContain('TURN')            // 无失败不吓唬运维
  })

  it('旧后端无 callConnect 字段 → 不渲染该卡（向后兼容，不崩）', () => {
    const spa = loadSpa()
    spa.state.lang = 'zh'
    spa.state.overview = overview() // 无 callConnect
    spa.renderDashboard()
    expect(spa.view.innerHTML).not.toContain('通话中继失败')
  })
})

describe('管理面板 通话记录区（紧急求助可辨识）', () => {
  const call = (over: Record<string, unknown>) => ({
    id: 'c1', callId: 'k1', callerId: 'u1', callerName: '小明', calleeId: 'u2', calleeName: '阿华',
    status: 'missed', createdAt: 1_700_000_000_000, ...over,
  })

  it('emergency:true 的记录带 🆘 紧急求助标；false/缺省不带（旧数据兼容）', () => {
    const spa = loadSpa()
    spa.state.lang = 'zh'
    spa.state.callsQuery = ''
    spa.state.calls = [call({ id: 'c1', emergency: true }), call({ id: 'c2', callerName: '普通甲', emergency: false }), call({ id: 'c3', callerName: '普通乙' })]
    spa.renderCalls()
    const html = spa.view.innerHTML
    expect(html).toContain('紧急求助')                       // SOS 行有标
    expect(html.split('紧急求助').length - 1).toBe(1)        // 恰 1 次=仅 c1 行（CSV 表头只在导出、不在 DOM）——false/缺省行都不带
    expect(html).toContain('小明')
    expect(html).toContain('普通甲')                          // 非紧急行照常渲染、不带标（次数断言已保证）
  })
})
