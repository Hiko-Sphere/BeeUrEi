// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

// Layout 依赖 router/session/api/通话上下文——逐个 mock，只验骨架结构（skip 链接 + main 目标）。
vi.mock('react-router-dom', () => ({
  NavLink: (p: { to: string; children: unknown }) => <a href={p.to}>{p.children as never}</a>,
  useLocation: () => ({ pathname: '/' }),
}))
vi.mock('../lib/session', () => ({
  useSession: () => ({ user: { id: 'u1', username: 'amy', displayName: '阿明', role: 'helper' }, signOut: vi.fn() }),
}))
vi.mock('../lib/api', () => ({
  api: {
    appConfig: vi.fn().mockResolvedValue({}),
    unreadSummary: vi.fn().mockResolvedValue({ notifications: 0, messages: 0 }),
    heartbeat: vi.fn().mockResolvedValue(undefined),
  },
}))
vi.mock('../pages/call/CallController', () => ({ CallProvider: (p: { children: unknown }) => p.children as never }))

import { activeNavLabel, Layout } from './Layout'

describe('Layout 无障碍骨架（skip 链接 + main 跳转目标）', () => {
  it('渲染"跳到主要内容"skip 链接，指向 #main', () => {
    render(<Layout><div>页面正文</div></Layout>)
    const skip = screen.getByText('跳到主要内容') // i18n 默认 zh
    expect(skip.tagName).toBe('A')
    expect(skip.getAttribute('href')).toBe('#main') // 同页片段跳转（非 router Link）
    expect(skip.className).toContain('skip-link')
  })

  it('主内容区带 id=main 与 tabIndex=-1（skip 链接的可聚焦跳转目标）', () => {
    const { container } = render(<Layout><div>页面正文</div></Layout>)
    const main = container.querySelector('main#main')
    expect(main).not.toBeNull()
    expect(main!.getAttribute('tabindex')).toBe('-1') // 使片段跳转能把键盘焦点落到正文
  })
})

// 路由切换朗读的最长前缀匹配（'/' 仅精确、子路由归属父项、未知回退）。
const nav = [
  { to: '/', label: '主页' },
  { to: '/calls', label: '通话' },
  { to: '/chat', label: '消息' },
  { to: '/admin', label: '管理' },
]

describe('activeNavLabel 路由→页名（aria-live 朗读）', () => {
  it("'/' 仅精确匹配，不被任何子路由借用", () => {
    expect(activeNavLabel('/', nav, 'BeeUrEi')).toBe('主页')
    // 子路由不得回落到 '/'（否则每页都播报"主页"）。
    expect(activeNavLabel('/calls', nav, 'BeeUrEi')).toBe('通话')
  })

  it('精确导航路由', () => {
    expect(activeNavLabel('/chat', nav, 'BeeUrEi')).toBe('消息')
  })

  it('子路由归属其父导航项（/chat/:id→消息、/admin/reports→管理）', () => {
    expect(activeNavLabel('/chat/u123', nav, 'BeeUrEi')).toBe('消息')
    expect(activeNavLabel('/admin/reports', nav, 'BeeUrEi')).toBe('管理')
  })

  it('前缀相似但非路径段边界的不误匹配（/chatroom≠/chat）', () => {
    // startsWith('/chat/') 要求斜杠边界，故 '/chatroom' 不该命中 /chat。
    expect(activeNavLabel('/chatroom', nav, 'BeeUrEi')).toBe('BeeUrEi')
  })

  it('未知路由回退到 fallback', () => {
    expect(activeNavLabel('/nope', nav, 'BeeUrEi')).toBe('BeeUrEi')
  })
})
