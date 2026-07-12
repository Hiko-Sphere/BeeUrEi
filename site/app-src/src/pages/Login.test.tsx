// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// LoginPage 只需 useSession(signIn) + useI18n(默认 ctx) + api（登录/注册初始渲染不调用；找回密码流程需 spy）。
const h = vi.hoisted(() => ({ forgot: vi.fn(), reset: vi.fn() }))
vi.mock('../lib/session', () => ({ useSession: () => ({ signIn: vi.fn() }) }))
vi.mock('../lib/api', () => ({ api: { forgotPassword: h.forgot, resetPassword: h.reset }, APIError: class extends Error { code = '' } }))
import { LoginPage } from './Login'

describe('LoginPage 找回密码流程（此前 web 完全缺失——忘密码即锁死）', () => {
  beforeEach(() => { h.forgot.mockReset(); h.reset.mockReset(); h.forgot.mockResolvedValue({ ok: true }); h.reset.mockResolvedValue({ ok: true }) })

  it('发验证码→填码+新密码→重置成功回登录（反枚举提示不暴露账号是否存在）', async () => {
    render(<LoginPage />)
    fireEvent.click(screen.getByRole('button', { name: '忘记密码？' }))
    fireEvent.change(screen.getByPlaceholderText('请输入账号'), { target: { value: 'alice' } })
    fireEvent.click(screen.getByRole('button', { name: '发送验证码' }))
    await waitFor(() => expect(h.forgot).toHaveBeenCalledWith('alice'))
    // 进入填码步 + 反枚举措辞（"如果该账号…"，不确认账号存在）。
    await screen.findByPlaceholderText('设置新密码')
    expect(screen.getByRole('status').textContent).toContain('如果该账号')
    fireEvent.change(screen.getByPlaceholderText('123456'), { target: { value: '654321' } })
    fireEvent.change(screen.getByPlaceholderText('设置新密码'), { target: { value: 'newsecret8' } })
    fireEvent.click(screen.getByRole('button', { name: '重置密码' }))
    await waitFor(() => expect(h.reset).toHaveBeenCalledWith('alice', '654321', 'newsecret8'))
    // 回登录页（登录/注册 tabs 复现）+ 成功提示。
    await screen.findByRole('button', { name: '注册' })
    expect(screen.getByRole('status').textContent).toContain('密码已重置')
  })

  it('重置新密码<8 位本地拦截、不打服务端（与注册同口径）', async () => {
    render(<LoginPage />)
    fireEvent.click(screen.getByRole('button', { name: '忘记密码？' }))
    fireEvent.change(screen.getByPlaceholderText('请输入账号'), { target: { value: 'alice' } })
    fireEvent.click(screen.getByRole('button', { name: '发送验证码' }))
    await screen.findByPlaceholderText('设置新密码')
    fireEvent.change(screen.getByPlaceholderText('123456'), { target: { value: '654321' } })
    fireEvent.change(screen.getByPlaceholderText('设置新密码'), { target: { value: '123' } })
    fireEvent.click(screen.getByRole('button', { name: '重置密码' }))
    expect(screen.getByRole('alert').textContent).toContain('密码至少 8 位')
    expect(h.reset).not.toHaveBeenCalled()
  })
})

describe('LoginPage 切换按钮的 aria-pressed 选中态（读屏可知当前模式/身份）', () => {
  it('登录页含官网回环链接（冷访客从官网点进来只见登录表单，须有路回去了解产品）', () => {
    render(<LoginPage />)
    const back = screen.getByRole('link', { name: '了解 BeeUrEi 是什么 →' })
    expect(back).toHaveAttribute('href', 'https://beeurei.hikosphere.com/')
    expect(back.getAttribute('rel') ?? '').toContain('noreferrer') // 新标签打开，登录进度不丢
  })

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
