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

  it('注册前端即时校验：非法用户名字符/过短密码给出明确本地化错误（不打服务端）', () => {
    render(<LoginPage />)
    fireEvent.click(screen.getByRole('button', { name: '注册' }))
    const username = screen.getByPlaceholderText('设置登录用户名')
    const password = screen.getByPlaceholderText('请输入密码')
    const create = () => fireEvent.click(screen.getByRole('button', { name: '创建账户' }))
    // 非法字符（@ 不在 [A-Za-z0-9_.-]，HTML minLength 管不到）→ 明确本地化报错，不打服务端。
    fireEvent.change(username, { target: { value: 'user@x' } })
    fireEvent.change(password, { target: { value: 'secret123' } })
    create()
    expect(screen.getByRole('alert').textContent).toContain('用户名只能含')
    // 用户名合法但密码过短 → 密码报错。
    fireEvent.change(username, { target: { value: 'validuser' } })
    fireEvent.change(password, { target: { value: '123' } })
    create()
    expect(screen.getByRole('alert').textContent).toContain('密码至少 8 位') // passwordPolicy：新设密码 ≥8
  })
})
