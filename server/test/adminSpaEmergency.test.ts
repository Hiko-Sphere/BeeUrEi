import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

/// 管理面板是无构建的 vanilla JS（public/admin/app.js），此前无任何可执行测试。用 node:vm 加载：
/// 顶层 const（state/I18N）不会挂到 vm 全局，故在 bootstrap render() 之前注入同脚本导出（replace 锚点
/// 不命中则显式抛错，绝不静默空测）；DOM 用**宽容自引用 stub 元素**（getElementById/querySelector 都回它，
/// innerHTML 可读写）——渲染函数写完 innerHTML 后测试读回断言，事件绑定全 noop。
interface SpaTest {
  state: { lang: string; emergencies: unknown[]; calls: unknown[]; callsQuery: string; overview: unknown; token: string | null }
  t: (k: string) => string
  emergencySection: () => string
  statCard: (k: string, v: unknown, sub?: string, cls?: string) => string
  renderCalls: () => void
  renderDashboard: () => void
  pickWsToken: (turnResp: unknown) => string
  emergenciesCsvRows: (list: Record<string, unknown>[]) => (string | number)[][]
  view: { innerHTML: string } // 渲染函数写入的共享 stub 元素（viewEl()/$ 都解析到它）
}
function loadSpa(): SpaTest {
  const path = fileURLToPath(new URL('../public/admin/app.js', import.meta.url))
  let src = readFileSync(path, 'utf8')
  const anchor = '\nrender();'
  if (!src.includes(anchor)) throw new Error('app.js bootstrap anchor "render();" not found — update test')
  src = src.replace(anchor, '\nglobalThis.__test = { state, t, emergencySection, statCard, renderCalls, renderDashboard, pickWsToken, emergenciesCsvRows };\nrender();')
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

  it('位置链接：合法数值坐标正常出 Apple Maps href（无回归）', () => {
    const spa = loadSpa()
    spa.state.lang = 'zh'
    spa.state.emergencies = [ev({ lat: 35.68, lon: 139.76, locSource: 'live' })]
    const html = spa.emergencySection()
    expect(html).toContain('https://maps.apple.com/?ll=35.68,139.76&q=35.68,139.76') // 数值坐标 encodeURIComponent 不变
    expect(html).toContain('实时位置')
  })

  it('位置链接：坐标做输出编码（汇聚点从严）——即便非数值坐标流到渲染层也无法破出 href 属性注入脚本', () => {
    const spa = loadSpa()
    spa.state.lang = 'zh'
    // 上游 z.number 校验本使这不可达，但汇聚点仍从严编码（防 DB 导入/迁移/历史行）：若某天有恶意坐标到此，须被中和。
    spa.state.emergencies = [ev({ lat: '"><img src=x onerror=alert(1)>', lon: 0, locSource: 'live' })]
    const html = spa.emergencySection()
    expect(html).not.toContain('<img src=x onerror=alert(1)>') // 未破出属性成为真实标签
    expect(html).not.toContain('"><img')                        // 引号未闭合属性提前
    expect(html).toContain('%22%3E%3Cimg')                      // 已被 encodeURIComponent 中和为百分号编码
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

  it('activeEmergencies>0 → 置顶 danger 卡「正在进行的紧急」；=0/缺省不渲染该卡', () => {
    const spa = loadSpa()
    spa.state.lang = 'zh'
    spa.state.overview = overview({ activeEmergencies: 2 })
    spa.renderDashboard()
    expect(spa.view.innerHTML).toContain('正在进行的紧急')
    expect(spa.view.innerHTML).toMatch(/class="v danger"[^>]*>\s*2/)
    spa.state.overview = overview({ activeEmergencies: 0 })
    spa.renderDashboard()
    expect(spa.view.innerHTML).not.toContain('正在进行的紧急') // 无危机不占位
    spa.state.overview = overview() // 旧后端无字段
    spa.renderDashboard()
    expect(spa.view.innerHTML).not.toContain('正在进行的紧急')
  })

  it('activeUnreachable>0 → 置顶 danger 卡「紧急·无人可即时触达」+ 行动提示；=0/缺省不渲染', () => {
    const spa = loadSpa()
    spa.state.lang = 'zh'
    spa.state.overview = overview({ activeEmergencies: 3, activeUnreachable: 1 })
    spa.renderDashboard()
    expect(spa.view.innerHTML).toContain('无人可即时触达')
    expect(spa.view.innerHTML).toContain('速联系本人') // 行动提示 sub
    expect(spa.view.innerHTML).toMatch(/class="v danger"[^>]*>\s*1/)
    spa.state.overview = overview({ activeEmergencies: 3, activeUnreachable: 0 })
    spa.renderDashboard()
    expect(spa.view.innerHTML).not.toContain('无人可即时触达') // 全部触达到人 → 不渲染此卡
    spa.state.overview = overview() // 旧后端无字段 → 不渲染（向后兼容）
    spa.renderDashboard()
    expect(spa.view.innerHTML).not.toContain('无人可即时触达')
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

  it('mail.failed>0 → 置顶 danger 卡「邮件发送失败」+ SMTP 提示；=0/缺省不渲染（运维看得见 SMTP 故障如 163 授权码过期）', () => {
    const spa = loadSpa()
    spa.state.lang = 'zh'
    spa.state.overview = overview({ mail: { sent: 10, failed: 4 } })
    spa.renderDashboard()
    expect(spa.view.innerHTML).toContain('邮件发送失败')
    expect(spa.view.innerHTML).toContain('SMTP')                 // 指向根因的提示
    expect(spa.view.innerHTML).toMatch(/class="v danger"[^>]*>\s*4/)
    spa.state.overview = overview({ mail: { sent: 10, failed: 0 } })
    spa.renderDashboard()
    expect(spa.view.innerHTML).not.toContain('邮件发送失败')     // 无失败不吓唬
    spa.state.overview = overview() // 旧后端无 mail 字段
    spa.renderDashboard()
    expect(spa.view.innerHTML).not.toContain('邮件发送失败')     // 向后兼容
  })

  it('safetyTickErrors>0 → 置顶 danger 卡「安全引擎报错」+ 提示；=0/缺省不渲染（dead-man\'s-switch 失灵运维可见）', () => {
    const spa = loadSpa()
    spa.state.lang = 'zh'
    spa.state.overview = overview({ safetyTickErrors: 3 })
    spa.renderDashboard()
    expect(spa.view.innerHTML).toContain('安全引擎报错')
    expect(spa.view.innerHTML).toContain('自动告警亲友') // 提示点明后果
    expect(spa.view.innerHTML).toMatch(/class="v danger"[^>]*>\s*3/)
    spa.state.overview = overview({ safetyTickErrors: 0 })
    spa.renderDashboard()
    expect(spa.view.innerHTML).not.toContain('安全引擎报错')
    spa.state.overview = overview() // 旧后端无字段
    spa.renderDashboard()
    expect(spa.view.innerHTML).not.toContain('安全引擎报错')
  })

  it('旧后端无 callConnect 字段 → 不渲染该卡（向后兼容，不崩）', () => {
    const spa = loadSpa()
    spa.state.lang = 'zh'
    spa.state.overview = overview() // 无 callConnect
    spa.renderDashboard()
    expect(spa.view.innerHTML).not.toContain('通话中继失败')
  })

  it('statCard 值做输出编码（汇聚点从严）：数字无损、恶意串被中和——面板文本插值不靠调用方只传数字的约束', () => {
    const spa = loadSpa()
    expect(spa.statCard('用户', 42, '', '')).toContain('>42<')         // 数字经 esc 无损
    const html = spa.statCard('x', '<img src=x onerror=alert(1)>', '', 'danger')
    expect(html).not.toContain('<img src=x onerror=alert(1)>')          // 未成真实标签
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;')        // 被 HTML 实体编码中和
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

  it('通话时长 durationSec 显示为 mm:ss（无/0 显示 —）', () => {
    const spa = loadSpa()
    spa.state.lang = 'zh'
    spa.state.callsQuery = ''
    spa.state.calls = [call({ id: 'c1', durationSec: 204 }), call({ id: 'c2', callerName: '甲', durationSec: 0 }), call({ id: 'c3', callerName: '乙' })]
    spa.renderCalls()
    const html = spa.view.innerHTML
    expect(html).toContain('3:24')                           // 204s → 3:24
    // 0 / 缺省时长显示 —（除表头"时长"外，— 恰两处：c2 与 c3）。
    expect(html.split('—').length - 1).toBe(2)
  })

  it('观察者信令用短时 wsToken（而非长效 admin 会话令牌）进 WS URL；旧服务端无 wsToken 则回退', () => {
    const spa = loadSpa()
    spa.state.token = 'ADMIN_SESSION_TOKEN'
    // turn 下发了短时 scope=ws 令牌 → 用它（进 URL 泄漏进日志也当不了 admin access token）。
    expect(spa.pickWsToken({ iceServers: [], wsToken: 'WS_SHORT_300s' })).toBe('WS_SHORT_300s')
    // 旧服务端/取 turn 失败无 wsToken → 回退 access token（握手仍接受，不阻断观察）。
    expect(spa.pickWsToken({ iceServers: [] })).toBe('ADMIN_SESSION_TOKEN')
    expect(spa.pickWsToken(null)).toBe('ADMIN_SESSION_TOKEN')
  })
})

describe('紧急事件 CSV 导出（事故留痕/合规审计）', () => {
  it('emergencySection 带导出按钮：有事件可点、空列表 disabled', () => {
    const spa = loadSpa()
    spa.state.emergencies = [ev({})]
    expect(spa.emergencySection()).toContain('data-action="exportEmerg"')
    expect(spa.emergencySection()).not.toMatch(/data-action="exportEmerg" disabled/)
    spa.state.emergencies = []
    expect(spa.emergencySection()).toMatch(/data-action="exportEmerg" disabled/) // 空列表禁用（无可导出）
  })

  it('emergenciesCsvRows：稳定英文列名 + ISO 时间戳 + 空值留空；响应时间线四列齐全', () => {
    const spa = loadSpa()
    const rows = spa.emergenciesCsvRows([
      ev({ lat: 31.2, lon: 121.5, locSource: 'live', ackedAt: 1_700_000_060_000, onWayAt: 1_700_000_120_000, escalatedAt: undefined, resolvedAt: 1_700_000_500_000 }) as Record<string, unknown>,
      ev({ id: 'e2', kind: 'manual', userName: undefined, username: undefined, lat: undefined, lon: undefined, notified: 0 }) as Record<string, unknown>,
    ])
    expect(rows[0]).toEqual(['kind', 'user', 'username', 'lat', 'lon', 'locSource', 'locAgeSec', 'notified', 'contacts', 'at', 'ackedAt', 'onWayAt', 'escalatedAt', 'resolvedAt'])
    // 事件行：坐标/来源/时间线如实；ISO-8601 时间戳（跨时区审计无歧义）。
    expect(rows[1]).toEqual(['fall', '小明', 'xiaoming', 31.2, 121.5, 'live', '', 1, 2,
      '2023-11-14T22:13:20.000Z', '2023-11-14T22:14:20.000Z', '2023-11-14T22:15:20.000Z', '', '2023-11-14T22:21:40.000Z'])
    // 已注销用户（无 userName）回落 userId；空值一律空串不写 "undefined"。
    expect(rows[2][1]).toBe('u1')
    expect(rows[2].every((c) => c !== 'undefined' && c !== undefined && c !== null)).toBe(true)
    // 空列表 → 只有表头（不吐空数据行）。
    expect(spa.emergenciesCsvRows([])).toHaveLength(1)
  })
})
