// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'

// 可变 token 快照：默认 null（挂载时 refreshMe 不触网）；resurrect 测试里先置 'T1' 再在途登出。
// clear() 同步清 token（镜像真实 tokenStore.clear）。vi.hoisted 把 mock 依赖提升到文件顶部。
const h = vi.hoisted(() => {
  const s = { token: null as string | null }
  return {
    s,
    logout: vi.fn(() => Promise.resolve(null)),
    clear: vi.fn(() => { s.token = null }),
    setUser: vi.fn(),
    me: vi.fn(),
    appConfig: vi.fn(() => Promise.resolve({ requireVerification: false })),
  }
})
vi.mock('./api', () => ({
  api: { logout: h.logout, me: h.me, appConfig: h.appConfig },
  tokenStore: { get token() { return h.s.token }, get refresh() { return 'RT1' }, get user() { return null }, clear: h.clear, setUser: h.setUser },
  setUnauthorizedHandler: vi.fn(),
}))

import { SessionProvider, useSession } from './session'

function Consumer() {
  const { signOut } = useSession()
  return <button onClick={signOut}>out</button>
}

describe('SessionProvider signOut', () => {
  beforeEach(() => { h.s.token = null; vi.clearAllMocks(); h.clear.mockImplementation(() => { h.s.token = null }) })

  it('登出时服务端吊销 refresh token（不只是清本地存储），并清本地状态', async () => {
    render(<SessionProvider><Consumer /></SessionProvider>)
    // 包在 act 里 await：signOut 的 setUser(null) 是异步落定，否则断言在状态落定前跑 + React act 警告。
    await act(async () => { fireEvent.click(screen.getByText('out')) })
    expect(h.logout).toHaveBeenCalledWith('RT1') // 调了 /api/auth/logout 吊销
    expect(h.clear).toHaveBeenCalled()           // 同时清本地
  })

  it('登出发生在 refreshMe 的 api.me 在途时：不复活已登出用户（复审 MED）', async () => {
    // 已登录：挂载 effect 触发 refreshMe → api.me（在途，手动解析）。
    h.s.token = 'T1'
    let resolveMe: (u: unknown) => void = () => {}
    h.me.mockReturnValue(new Promise((r) => { resolveMe = r }))
    let seen = 'init'
    function C() {
      const { user, signOut } = useSession()
      seen = user ? `in:${(user as { id: string }).id}` : 'out'
      return <button onClick={signOut}>out</button>
    }
    render(<SessionProvider><C /></SessionProvider>)
    // api.me 尚未解析；用户在此刻**显式登出**（clear 同步清 token）。
    await act(async () => { fireEvent.click(screen.getByText('out')) })
    expect(h.s.token).toBe(null)
    // 现在 api.me 才成功返回（请求携登出前的有效 token 已发出）：refreshMe 续体必须发现 token 已清而放弃提交。
    await act(async () => { resolveMe({ id: 'u1', username: 'u1', displayName: 'U', role: 'helper' }); await Promise.resolve(); await Promise.resolve() })
    expect(seen).toBe('out')                    // 不复活：用户仍是登出态（不回退到已登录 UI）
    expect(h.setUser).not.toHaveBeenCalled()    // 不把已登出用户写回 localStorage(LS_USER)
  })
})
