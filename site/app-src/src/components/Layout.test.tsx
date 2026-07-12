// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

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
    heartbeatOffBeacon: vi.fn(),
  },
}))
vi.mock('../pages/call/CallController', () => ({ CallProvider: (p: { children: unknown }) => p.children as never }))

import { activeNavLabel, Layout } from './Layout'
import { api } from '../lib/api'

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

describe('未接来电角标（unreadSummary.missedCalls → 通话导航项）', () => {
  it('missedCalls>0 → /calls 导航项显示角标数字', async () => {
    ;(api.unreadSummary as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ notifications: 0, messages: 0, missedCalls: 2, total: 2 })
    const { container } = render(<Layout><div>x</div></Layout>)
    await waitFor(() => {
      const callsLinks = [...container.querySelectorAll('a[href="/calls"]')]
      expect(callsLinks.length).toBeGreaterThan(0)                        // 通话导航项存在
      expect(callsLinks.some((a) => a.textContent?.includes('2'))).toBe(true) // 其上显示未接角标 2
    })
  })

  it('missedCalls=0 → /calls 导航项无角标数字', async () => {
    ;(api.unreadSummary as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ notifications: 0, messages: 0, missedCalls: 0, total: 0 })
    const { container } = render(<Layout><div>x</div></Layout>)
    await screen.findAllByText('通话')  // 等渲染完成
    const callsLinks = [...container.querySelectorAll('a[href="/calls"]')]
    expect(callsLinks.every((a) => !/\d/.test(a.textContent ?? ''))) .toBe(true) // 无数字角标
  })
})

describe('PWA 应用图标角标（Badging API）随未读总数更新', () => {
  const navAny = navigator as unknown as { setAppBadge?: unknown; clearAppBadge?: unknown }
  afterEach(() => { delete navAny.setAppBadge; delete navAny.clearAppBadge })

  it('未读总数>0 → navigator.setAppBadge(total)（消息+通知+未接来电之和）', async () => {
    const set = vi.fn().mockResolvedValue(undefined)
    navAny.setAppBadge = set; navAny.clearAppBadge = vi.fn().mockResolvedValue(undefined)
    ;(api.unreadSummary as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ notifications: 2, messages: 1, missedCalls: 3, total: 6 })
    render(<Layout><div>x</div></Layout>)
    await waitFor(() => expect(set).toHaveBeenCalledWith(6)) // 2+1+3
  })

  it('未读总数=0 → clearAppBadge', async () => {
    const clear = vi.fn().mockResolvedValue(undefined)
    navAny.setAppBadge = vi.fn().mockResolvedValue(undefined); navAny.clearAppBadge = clear
    ;(api.unreadSummary as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ notifications: 0, messages: 0, missedCalls: 0, total: 0 })
    render(<Layout><div>x</div></Layout>)
    await waitFor(() => expect(clear).toHaveBeenCalled())
  })

  it('登出(卸载 Layout)复位标签标题与图标角标，不残留上一用户未读数（共享电脑）', async () => {
    const clear = vi.fn().mockResolvedValue(undefined)
    navAny.setAppBadge = vi.fn().mockResolvedValue(undefined); navAny.clearAppBadge = clear
    ;(api.unreadSummary as ReturnType<typeof vi.fn>).mockResolvedValue({ notifications: 3, messages: 0, missedCalls: 0, total: 3 })
    const { unmount } = render(<Layout><div>x</div></Layout>)
    await waitFor(() => expect(document.title).toMatch(/^\(3\) /)) // 有未读 → 标题带 "(3) " 前缀
    clear.mockClear()
    unmount() // 会话卸载=登出
    expect(document.title).not.toMatch(/^\(/) // 标题复位：不再带 "(N)" 前缀
    expect(clear).toHaveBeenCalled()           // 图标角标被清（updateAppBadge(0)）
  })
})

describe('待命心跳', () => {
  const heartbeat = () => api.heartbeat as ReturnType<typeof vi.fn>
  it('待命中回到前台(visibilitychange)立即补一次心跳——后台节流下 presence 不误过期离线', () => {
    localStorage.setItem('beeurei.web.available', '1') // 开着待命
    heartbeat().mockClear()
    render(<Layout><div>x</div></Layout>)
    expect(heartbeat()).toHaveBeenCalledWith(true) // 挂载即上报待命
    heartbeat().mockClear()
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true })
    document.dispatchEvent(new Event('visibilitychange'))
    expect(heartbeat()).toHaveBeenCalledWith(true) // 回前台立即补，不干等下一次心跳
    localStorage.removeItem('beeurei.web.available')
  })

  it('待命中关闭/离开页面(pagehide)→ 走 keepalive beacon 立即下线（非普通 heartbeat，否则 unload 被取消、发不出）', () => {
    localStorage.setItem('beeurei.web.available', '1')
    const beacon = api.heartbeatOffBeacon as ReturnType<typeof vi.fn>
    beacon.mockClear()
    render(<Layout><div>x</div></Layout>)
    window.dispatchEvent(new Event('pagehide'))
    expect(beacon).toHaveBeenCalledTimes(1) // 用 beacon（keepalive）而非普通 heartbeat
    localStorage.removeItem('beeurei.web.available')
  })

  it('未待命时关闭页面不发下线 beacon（本就离线，无需骚扰服务端）', () => {
    localStorage.setItem('beeurei.web.available', '0')
    const beacon = api.heartbeatOffBeacon as ReturnType<typeof vi.fn>
    beacon.mockClear()
    render(<Layout><div>x</div></Layout>)
    window.dispatchEvent(new Event('pagehide'))
    expect(beacon).not.toHaveBeenCalled()
    localStorage.removeItem('beeurei.web.available')
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
