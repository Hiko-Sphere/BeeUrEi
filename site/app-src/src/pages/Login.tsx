import { useState } from 'react'
import { api, APIError } from '../lib/api'
import { useSession } from '../lib/session'
import { useI18n } from '../lib/i18n'
import { getTheme, setTheme, type Theme } from '../lib/theme'
import { Button, Field, Input } from '../components/ui'
import { IconLogo } from '../components/icons'

type Mode = 'login' | 'register'

export function LoginPage() {
  const { signIn } = useSession()
  const { t, lang, setLang } = useI18n()
  const [mode, setMode] = useState<Mode>('login')
  const [identifier, setIdentifier] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [role, setRole] = useState<'helper' | 'family'>('helper')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [twoFA, setTwoFA] = useState(false)     // 登录遇两步验证挑战：显示验证码输入
  const [totpCode, setTotpCode] = useState('')

  const errorText = (code: string): string => {
    switch (code) {
      case 'invalid_credentials': return t('账号或密码不正确', 'Incorrect account or password')
      case 'username_taken': return t('该用户名已被占用', 'That username is taken')
      case 'registration_disabled': return t('注册暂时关闭', 'Registration is currently closed')
      case 'password_too_short': return t('密码至少 8 位', 'Password must be at least 8 characters')
      case 'password_too_common': return t('这个密码太常见，容易被猜到——换一个更独特的', 'That password is too common — pick something more unique')
      case 'account_disabled': return t('该账号已被停用，请联系管理员', 'This account has been disabled — please contact the administrator')
      case 'too_many_requests': return t('尝试过于频繁，请稍候再试', 'Too many attempts — please wait a moment')
      case 'content_blocked': return t('该内容不被允许，请换一个', "That's not allowed — please choose another")
      case 'network': return t('网络连接失败，请重试', 'Network error, please retry')
      case 'invalid_input': return t('请检查输入内容', 'Please check your input')
      default: return t('操作失败，请重试', 'Something went wrong, please retry')
    }
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    // 注册前端校验：与后端 auth.ts 同口径（用户名 3–32 且仅字母数字 _.- ；密码 ≥6）。
    // 否则非法输入要打到服务端才被 invalid_input 泛拒，用户看不出错在哪（与改密表单已有的即时校验对齐）。
    if (mode === 'register') {
      const u = username.trim()
      if (u.length < 3 || u.length > 32) { setError(t('用户名需 3–32 位', 'Username must be 3–32 characters')); return }
      if (!/^[A-Za-z0-9_.-]+$/.test(u)) { setError(t('用户名只能含字母、数字和 _ . -', 'Username may only contain letters, numbers, and _ . -')); return }
      if (password.length < 6) { setError(t('密码至少 6 位', 'Password must be at least 6 characters')); return }
    }
    setBusy(true)
    try {
      const res = mode === 'login'
        ? await api.login(identifier.trim(), password, twoFA ? totpCode.trim() : undefined)
        : await api.register(username.trim(), password, role)
      signIn(res.token, res.refreshToken, res.user)
    } catch (err) {
      const code = err instanceof APIError ? err.code : 'unknown'
      if (code === 'two_factor_required') { setTwoFA(true); setError(null) }       // 第一因子已过，需补验证码
      else if (code === 'invalid_2fa') { setTwoFA(true); setError(t('验证码不对，请重试', "That code didn't work — please try again")) }
      else setError(errorText(code))
    } finally {
      setBusy(false)
    }
  }

  const cycleTheme = () => { const order: Theme[] = ['auto', 'light', 'dark']; setTheme(order[(order.indexOf(getTheme()) + 1) % 3]) }

  return (
    <div className="grid min-h-dvh place-items-center px-4 py-10" style={{ background: 'radial-gradient(120% 80% at 50% -10%, color-mix(in srgb, var(--color-honey) 14%, transparent), transparent 70%)' }}>
      <div className="absolute right-4 top-4 flex gap-2 text-xs">
        <button onClick={cycleTheme} className="rounded-lg px-2 py-1.5 text-soft hover:surface-2">{{ auto: t('跟随系统', 'Auto'), light: t('浅色', 'Light'), dark: t('深色', 'Dark') }[getTheme()]}</button>
        <button onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')} className="rounded-lg px-2 py-1.5 text-soft hover:surface-2">{lang === 'zh' ? 'EN' : '中文'}</button>
      </div>

      <div className="w-full max-w-sm">
        <div className="mb-7 flex flex-col items-center gap-3 text-center">
          <IconLogo width={56} height={56} />
          <div>
            <h1 className="text-2xl font-bold tracking-tight">BeeUrEi</h1>
            <p className="mt-1 text-sm text-faint">{t('协助者 / 亲友 网页端', 'Helper / Family Web')}</p>
          </div>
        </div>

        <div className="surface rounded-2xl border border-[var(--line)] p-6 shadow-sm">
          <div className="mb-5 grid grid-cols-2 gap-1 rounded-xl surface-2 p-1 text-sm">
            <button aria-pressed={mode === 'login'} onClick={() => { setMode('login'); setError(null) }} className={`rounded-lg py-2 font-medium transition ${mode === 'login' ? 'surface shadow-sm' : 'text-faint'}`}>{t('登录', 'Sign in')}</button>
            <button aria-pressed={mode === 'register'} onClick={() => { setMode('register'); setError(null) }} className={`rounded-lg py-2 font-medium transition ${mode === 'register' ? 'surface shadow-sm' : 'text-faint'}`}>{t('注册', 'Register')}</button>
          </div>

          {twoFA ? (
            <form onSubmit={submit} className="flex flex-col gap-4">
              <p className="text-sm text-soft">{t('打开你的身份验证器 App，输入 6 位验证码继续登录；也可输入一次性恢复码。', 'Open your authenticator app and enter the 6-digit code to finish signing in. You can also use a one-time recovery code.')}</p>
              <Field label={t('验证码 / 恢复码', 'Code / recovery code')}>
                <Input value={totpCode} onChange={(e) => setTotpCode(e.target.value)} autoComplete="one-time-code" autoCapitalize="characters" required placeholder="123456" />
              </Field>
              {error && <div className="rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">{error}</div>}
              <Button type="submit" loading={busy} className="mt-1 w-full py-3 text-base">{t('验证并登录', 'Verify & sign in')}</Button>
              <button type="button" onClick={() => { setTwoFA(false); setTotpCode(''); setError(null) }} className="text-sm text-faint hover:text-soft">{t('返回', 'Back')}</button>
            </form>
          ) : (
          <form onSubmit={submit} className="flex flex-col gap-4">
            {mode === 'login' ? (
              <Field label={t('用户名 / 邮箱 / 手机号', 'Username / Email / Phone')}>
                <Input value={identifier} onChange={(e) => setIdentifier(e.target.value)} autoComplete="username" autoCapitalize="none" required placeholder={t('请输入账号', 'Your account')} />
              </Field>
            ) : (
              <>
                <Field label={t('用户名', 'Username')} hint={t('3–32 位，字母/数字/下划线', '3–32 chars, letters/numbers/_')}>
                  <Input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" autoCapitalize="none" required minLength={3} maxLength={32} placeholder={t('设置登录用户名', 'Choose a username')} />
                </Field>
                {/* 身份是一组互斥按钮（非单个表单控件），用 role=group + aria-label 命名分组；
                    不可用 Field(<label>) 包多个按钮——会把"身份"拼进每个按钮的可朗读名且语义非法。 */}
                <div role="group" aria-label={t('身份', 'Your role')}>
                  <span className="mb-1.5 block text-sm font-medium text-soft">{t('身份', 'Your role')}</span>
                  <div className="grid grid-cols-2 gap-2">
                    {(['helper', 'family'] as const).map((r) => (
                      <button type="button" key={r} aria-pressed={role === r} onClick={() => setRole(r)}
                        className={`rounded-xl border px-3 py-2.5 text-sm font-medium transition ${role === r ? 'border-honey bg-honey/10' : 'border-[var(--line)] text-soft'}`}>
                        {r === 'helper' ? t('志愿者', 'Volunteer') : t('亲友', 'Family')}
                      </button>
                    ))}
                  </div>
                </div>
              </>
            )}
            <Field label={t('密码', 'Password')}>
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required minLength={6} placeholder={t('请输入密码', 'Your password')} />
            </Field>

            {error && <div className="rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">{error}</div>}

            <Button type="submit" loading={busy} className="mt-1 w-full py-3 text-base">{mode === 'login' ? t('登录', 'Sign in') : t('创建账户', 'Create account')}</Button>
          </form>
          )}
        </div>

        <p className="mt-6 text-center text-xs leading-relaxed text-faint">
          {t('继续即表示同意', 'By continuing you agree to our ')}
          <a className="text-accent hover:underline" href="https://beeurei.hikosphere.com/legal/" target="_blank" rel="noreferrer">{t('隐私政策与条款', 'Privacy & Terms')}</a>。
          <br />{t('视障用户请使用 iOS 客户端。', 'Blind users: please use the iOS app.')}
        </p>
      </div>
    </div>
  )
}
