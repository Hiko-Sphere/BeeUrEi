// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'

// token=null → 挂载时 refreshMe 不触网（不调 api.me/appConfig）；refresh 有值 → signOut 应据此吊销。
// vi.hoisted：mock 工厂被提升到文件顶部，引用的 fn 必须同样提升，否则 "before initialization"。
const { logout, clear } = vi.hoisted(() => ({ logout: vi.fn(() => Promise.resolve(null)), clear: vi.fn() }))
vi.mock('./api', () => ({
  api: { logout },
  tokenStore: { get token() { return null }, get refresh() { return 'RT1' }, get user() { return null }, clear, setUser: vi.fn() },
  setUnauthorizedHandler: vi.fn(),
}))

import { SessionProvider, useSession } from './session'

function Consumer() {
  const { signOut } = useSession()
  return <button onClick={signOut}>out</button>
}

describe('SessionProvider signOut', () => {
  it('登出时服务端吊销 refresh token（不只是清本地存储），并清本地状态', async () => {
    render(<SessionProvider><Consumer /></SessionProvider>)
    // 包在 act 里 await：signOut 的 setUser(null) 是异步落定，否则断言在状态落定前跑 + React act 警告。
    await act(async () => { fireEvent.click(screen.getByText('out')) })
    expect(logout).toHaveBeenCalledWith('RT1') // 调了 /api/auth/logout 吊销
    expect(clear).toHaveBeenCalled()           // 同时清本地
  })
})
