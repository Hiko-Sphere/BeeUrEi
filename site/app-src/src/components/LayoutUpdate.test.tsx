// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'

// 新版本提示：长开标签页跑旧包的出口——周期比对部署 index.html 主包哈希，不同→"应用有新版本 · 点击刷新"。
vi.mock('react-router-dom', () => ({
  NavLink: (p: { to: string; children: unknown }) => <a href={p.to}>{p.children as never}</a>,
  useLocation: () => ({ pathname: '/' }),
}))
vi.mock('../lib/session', () => ({
  useSession: () => ({ user: { id: 'u1', username: 'amy', displayName: '阿明', role: 'helper' }, self: null, signOut: vi.fn(), refreshMe: vi.fn() }),
}))
vi.mock('../lib/api', () => ({
  api: {
    appConfig: vi.fn().mockResolvedValue({}),
    unreadSummary: vi.fn().mockResolvedValue({ notifications: 0, messages: 0, missedCalls: 0 }),
    heartbeat: vi.fn().mockResolvedValue(undefined),
  },
}))
vi.mock('../pages/call/CallController', () => ({ CallProvider: (p: { children: unknown }) => p.children as never }))
import { Layout } from './Layout'

const htmlWith = (asset: string) => `<!doctype html><html><head><script src="/app/${asset}"></script></head><body></body></html>`

describe('Layout 新版本提示（部署后长开标签页不再默默跑旧码）', () => {
  let curScript: HTMLScriptElement
  beforeEach(() => {
    vi.clearAllMocks()
    // 当前运行版本：文档里挂一个内容哈希主包 script（jsdom 渲染不会真有，手动注入）。
    curScript = document.createElement('script')
    curScript.setAttribute('src', '/app/assets/index-AAA1.js')
    document.head.appendChild(curScript)
  })
  afterEach(() => { curScript.remove(); vi.unstubAllGlobals() })

  it('部署了新包（index.html 哈希变了）→ 10 分钟检查后出现"应用有新版本"+刷新按钮', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ text: () => Promise.resolve(htmlWith('assets/index-BBB2.js')) }))
    vi.useFakeTimers()
    try {
      render(<Layout><div>正文</div></Layout>)
      expect(screen.queryByText('应用有新版本')).toBeNull() // 开屏不查（刚加载必是新版本）
      await act(async () => { await vi.advanceTimersByTimeAsync(10 * 60_000) }) // 到 10 分钟周期
    } finally { vi.useRealTimers() }
    expect(await screen.findByText('应用有新版本')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '点击刷新' })).toBeInTheDocument()
  })

  it('同版本 / 拉取失败 → 不提示（绝不误报打扰）', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ text: () => Promise.resolve(htmlWith('assets/index-AAA1.js')) }))
    vi.useFakeTimers()
    try {
      render(<Layout><div>正文</div></Layout>)
      await act(async () => { await vi.advanceTimersByTimeAsync(10 * 60_000) })
      expect(screen.queryByText('应用有新版本')).toBeNull() // 同版本：无横幅
      // 网络失败：同样静默（下个周期再查）。
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('net')))
      await act(async () => { await vi.advanceTimersByTimeAsync(10 * 60_000) })
      expect(screen.queryByText('应用有新版本')).toBeNull()
    } finally { vi.useRealTimers() }
  })
})
