// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'

// LoginPage 只需 useSession(signIn) + useI18n(默认 ctx) + api(初始渲染不调用)；无 router 依赖。
vi.mock('../lib/session', () => ({ useSession: () => ({ signIn: vi.fn() }) }))
vi.mock('../lib/api', () => ({ api: {}, APIError: class extends Error {} }))
import { LoginPage } from './Login'

describe('LoginPage 切换按钮的 aria-pressed 选中态（读屏可知当前模式/身份）', () => {
  it('模式切换与身份选择都暴露 aria-pressed，且互斥更新', () => {
    render(<LoginPage />)
    // 默认登录模式：用唯一的"注册"切换钮断言（"登录"会与提交钮重名，避开）。
    const register = screen.getByRole('button', { name: '注册' })
    expect(register).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(register)
    expect(register).toHaveAttribute('aria-pressed', 'true')

    // 注册模式出现身份选择，默认 helper（志愿者）选中。
    const volunteer = screen.getByRole('button', { name: '志愿者' })
    const family = screen.getByRole('button', { name: '亲友' })
    expect(volunteer).toHaveAttribute('aria-pressed', 'true')
    expect(family).toHaveAttribute('aria-pressed', 'false')
    fireEvent.click(family)
    expect(family).toHaveAttribute('aria-pressed', 'true')
    expect(volunteer).toHaveAttribute('aria-pressed', 'false') // 互斥
  })
})
