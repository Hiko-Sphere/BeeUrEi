// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import axe from 'axe-core'

/// 无障碍回归门禁（把 2026-07-03 的一次性 axe 人工审计固化进 CI）：渲染代表性页面跑 axe-core，
/// 0 violations 才绿——协助端服务视障用户的亲友，无障碍回归（丢 label/按钮无名/aria 误用）必须被挡在合并前。
/// jsdom 限制：color-contrast 需要真实排版计算（对比度已人工审计过且由主题 token 锁定，见 index.css 注释）；
/// region/landmark 规则针对整页（这里渲染的是 Layout 之内的页面片段，地标由 Layout 提供）——两者禁用，
/// 其余规则（label/button-name/image-alt/aria-*/list 结构等）在 jsdom 下完全有效。
async function expectNoAxeViolations(container: Element) {
  const results = await axe.run(container, {
    rules: {
      'color-contrast': { enabled: false }, // 需真实排版；对比度已审计并由主题 token 固定
      region: { enabled: false },           // 地标由 Layout 承担，页面片段单渲不适用
    },
  })
  // 失败时输出"规则 + 命中节点"而非笼统 diff，便于直接定位。
  expect(results.violations.map((v) => ({ rule: v.id, help: v.help, nodes: v.nodes.map((n) => n.target.join(' ')) }))).toEqual([])
}

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }))
vi.mock('./lib/session', () => ({ useSession: () => ({ signIn: vi.fn() }) }))
vi.mock('./lib/api', () => ({
  api: { notifications: vi.fn(), markAllNotifsRead: vi.fn(), markNotifRead: vi.fn() },
  APIError: class extends Error {},
}))
import { api } from './lib/api'
import { LoginPage } from './pages/Login'
import { NotificationsPage } from './pages/Notifications'

describe('axe 无障碍回归门禁（代表性页面 0 violations）', () => {
  it('登录页（含注册模式的身份选择）', async () => {
    const { container, getByRole } = render(<LoginPage />)
    await expectNoAxeViolations(container)
    // 注册模式（多出身份选择/更多表单控件）同样干净。
    getByRole('button', { name: '注册' }).click()
    await expectNoAxeViolations(container)
  })

  it('通知页（含紧急告警的位置链接与操作按钮）', async () => {
    ;(api.notifications as ReturnType<typeof vi.fn>).mockResolvedValue({
      notifications: [
        { id: 'e1', userId: 'u1', kind: 'emergency_alert', title: '摔倒告警', body: '可能摔倒',
          createdAt: 1_700_000_000_000, data: { lat: '31.2', lon: '121.4', kind: 'fall', fromId: 'x', fromName: '老王' } },
        { id: 'r1', userId: 'u1', kind: 'report_resolved', title: '处置完成', body: '已处理你的举报',
          createdAt: 1_700_000_000_000, readAt: 1_700_000_100_000 },
      ],
      unread: 1,
    })
    const { container, findByText } = render(<NotificationsPage />)
    await findByText('摔倒告警') // 等数据渲染完再审（空壳通过没有意义）
    await expectNoAxeViolations(container)
  })

  it('门禁自检：axe 在本环境确实能抓到违规（防"永远绿"的假门禁）', async () => {
    // 无名按钮 + 无 alt 图片：若 axe 在 jsdom 里静默失效，此测会红——保证上面的 0 violations 是真的。
    const host = document.createElement('div')
    host.innerHTML = '<button></button><img src="x.png">'
    document.body.appendChild(host)
    try {
      const results = await axe.run(host)
      const rules = results.violations.map((v) => v.id)
      expect(rules).toContain('button-name')
      expect(rules).toContain('image-alt')
    } finally {
      host.remove()
    }
  })
})
