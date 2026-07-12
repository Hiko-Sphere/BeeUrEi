import { useState } from 'react'
import { api, APIError } from '../lib/api'
import { useSession } from '../lib/session'
import { useI18n } from '../lib/i18n'
import { passkeySupported, getPasskey } from '../lib/webauthn'
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
  const [pkBusy, setPkBusy] = useState(false) // 通行密钥登录进行中（独立于表单 busy：浏览器弹窗期间表单仍可用）
  // 邮箱验证码登录（免密）：两步（发码→验码）；2FA 账号第三步补验证码。
  const [emailMode, setEmailMode] = useState(false)
  const [email, setEmail] = useState('')
  const [emailCode, setEmailCode] = useState('')
  const [emailCodeSent, setEmailCodeSent] = useState(false)
  const [emailTotp, setEmailTotp] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [twoFA, setTwoFA] = useState(false)     // 登录遇两步验证挑战：显示验证码输入
  const [totpCode, setTotpCode] = useState('')
  const [forgot, setForgot] = useState(false)   // 找回密码流程（此前 web 完全缺失——忘密码即锁死，见 iOS AuthGateView）
  const [codeSent, setCodeSent] = useState(false) // 找回：验证码是否已发（进入"填码+新密码"步）
  const [resetCode, setResetCode] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [notice, setNotice] = useState<string | null>(null) // 非错误提示（验证码已发 / 重置成功回登录）

  const errorText = (code: string): string => {
    switch (code) {
      case 'invalid_credentials': return t('账号或密码不正确', 'Incorrect account or password')
      case 'username_taken': return t('该用户名已被占用', 'That username is taken')
      case 'registration_disabled': return t('注册暂时关闭', 'Registration is currently closed')
      case 'password_too_short': return t('密码至少 8 位', 'Password must be at least 8 characters')
      case 'password_too_common': return t('这个密码太常见，容易被猜到——换一个更独特的', 'That password is too common — pick something more unique')
      case 'password_too_similar': return t('密码里不要包含你的用户名或邮箱，太容易被猜到', "Don't include your username or email in the password")
      case 'too_many_attempts': return t('尝试太频繁，请稍等片刻再试', 'Too many attempts — wait a moment and try again')
      case 'account_disabled': return t('该账号已被停用，请联系管理员', 'This account has been disabled — please contact the administrator')
      case 'too_many_requests': return t('尝试过于频繁，请稍候再试', 'Too many attempts — please wait a moment')
      case 'invalid_code': return t('验证码不对或已过期，请重新获取', 'That code is wrong or expired — request a new one')
      case 'code_cooldown': case 'code_too_many': return t('发送太频繁，请稍等再试', 'Too many requests — wait a moment and try again')
      case 'mail_unavailable': return t('邮件服务暂时不可用，请稍后再试或改用密码登录', 'Email service is temporarily unavailable — try later or use your password')
      case 'content_blocked': return t('该内容不被允许，请换一个', "That's not allowed — please choose another")
      case 'network': return t('网络连接失败，请重试', 'Network error, please retry')
      case 'invalid_input': return t('请检查输入内容', 'Please check your input')
      default: return t('操作失败，请重试', 'Something went wrong, please retry')
    }
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    // 注册前端校验：与后端 auth.ts + passwordPolicy 同口径（用户名 3–32 且仅字母数字 _.- ；新设密码 ≥8）。
    // 否则非法输入要打到服务端才被 invalid_input 泛拒，用户看不出错在哪（与改密表单已有的即时校验对齐）。
    // 登录侧**刻意不设长度预检**：存量 6-7 位老密码须能登录（免迁移），对错交给服务端判。
    if (mode === 'register') {
      const u = username.trim()
      if (u.length < 3 || u.length > 32) { setError(t('用户名需 3–32 位', 'Username must be 3–32 characters')); return }
      if (!/^[A-Za-z0-9_.-]+$/.test(u)) { setError(t('用户名只能含字母、数字和 _ . -', 'Username may only contain letters, numbers, and _ . -')); return }
      if (password.length < 8) { setError(t('密码至少 8 位', 'Password must be at least 8 characters')); return }
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

  // 通行密钥登录：options（服务端按 Origin 用前端域做 rpID）→ 浏览器系统级确认 → verify 发令牌。
  // 用户取消（NotAllowedError）静默返回——那是改主意，不是错误。
  const passkeyLogin = async () => {
    setError(null); setNotice(null); setPkBusy(true)
    try {
      const { flowId, options } = await api.passkeyLoginOptions()
      const assertion = await getPasskey(options)
      const res = await api.passkeyLoginVerify(flowId, assertion)
      signIn(res.token, res.refreshToken, res.user)
    } catch (err) {
      if (err instanceof APIError) {
        setError(err.code === 'unknown_credential'
          ? t('这把通行密钥不属于任何账号（可能已被删除）', "This passkey doesn't match any account (it may have been deleted)")
          : err.code === 'account_disabled' ? t('该账号已被停用', 'This account is disabled') : errorText(err.code))
      } else if ((err as Error)?.name !== 'NotAllowedError') {
        setError(t('通行密钥登录失败，请重试或改用密码', 'Passkey sign-in failed — try again or use your password'))
      }
    } finally { setPkBusy(false) }
  }

  // 邮箱验证码登录 · 发码：反枚举对称（已注册/未注册都发），提示措辞不暴露账号是否存在。
  const sendEmailCode = async (e: React.FormEvent) => {
    e.preventDefault(); setError(null); setNotice(null)
    setBusy(true)
    try {
      await api.emailRequestCode(email.trim())
      setEmailCodeSent(true)
      setNotice(t('验证码已发送，请查收邮箱后填写下方。', 'Code sent — check your inbox and enter it below.'))
    } catch (err) { setError(errorText(err instanceof APIError ? err.code : 'unknown')) }
    finally { setBusy(false) }
  }

  // 邮箱验证码登录 · 验码：已有账号即登录（开了 2FA 的追加第二因子）；未注册邮箱自动建号（服务端注册开关管制）。
  const verifyEmailCode = async (e: React.FormEvent) => {
    e.preventDefault(); setError(null)
    setBusy(true)
    try {
      const res = await api.emailVerifyCode(email.trim(), emailCode.trim(), emailTotp ? { totpCode: totpCode.trim() } : undefined)
      signIn(res.token, res.refreshToken, res.user)
    } catch (err) {
      const code = err instanceof APIError ? err.code : 'unknown'
      if (code === 'two_factor_required') { setEmailTotp(true); setError(null) }
      else if (code === 'invalid_2fa') { setEmailTotp(true); setError(t('验证码不对，请重试', "That code didn't work — please try again")) }
      // 邮箱流里的"注册关闭"要点破前半句（该邮箱未注册）——通用文案"注册暂时关闭"会让存量用户误以为自己登录被关。
      else if (code === 'registration_disabled') setError(t('该邮箱未注册，且当前未开放新账号注册', "This email isn't registered, and new sign-ups are currently closed"))
      else setError(errorText(code))
    } finally { setBusy(false) }
  }

  const leaveEmailMode = () => {
    setEmailMode(false); setEmailCodeSent(false); setEmailCode(''); setEmailTotp(false); setTotpCode(''); setError(null); setNotice(null)
  }

  // 找回密码 · 第一步：向账号绑定的**已验证**邮箱发验证码。服务端反枚举、恒 ok，故成功即进填码步、提示措辞不暴露账号是否存在。
  const sendResetCode = async (e: React.FormEvent) => {
    e.preventDefault(); setError(null); setNotice(null)
    if (!identifier.trim()) { setError(t('请输入账号', 'Enter your account')); return }
    setBusy(true)
    try {
      await api.forgotPassword(identifier.trim())
      setCodeSent(true)
      setNotice(t('如果该账号绑定了已验证邮箱，验证码已发送，请查收后填写下方。', 'If this account has a verified email, a code was sent — check your inbox and enter it below.'))
    } catch (err) {
      setError(errorText(err instanceof APIError ? err.code : 'unknown'))
    } finally { setBusy(false) }
  }

  // 找回密码 · 第二步：凭码设新密码。成功后回登录页并提示用新密码登录。
  const doReset = async (e: React.FormEvent) => {
    e.preventDefault(); setError(null); setNotice(null)
    if (newPassword.length < 8) { setError(t('密码至少 8 位', 'Password must be at least 8 characters')); return }
    setBusy(true)
    try {
      await api.resetPassword(identifier.trim(), resetCode.trim(), newPassword)
      leaveForgot()
      setPassword('')
      setNotice(t('密码已重置，请用新密码登录。', 'Password reset — sign in with your new password.'))
    } catch (err) {
      setError(errorText(err instanceof APIError ? err.code : 'unknown'))
    } finally { setBusy(false) }
  }

  const leaveForgot = () => { setForgot(false); setCodeSent(false); setResetCode(''); setNewPassword(''); setError(null) }

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
          {!twoFA && !forgot && !emailMode && (
          <div className="mb-5 grid grid-cols-2 gap-1 rounded-xl surface-2 p-1 text-sm">
            <button aria-pressed={mode === 'login'} onClick={() => { setMode('login'); setError(null); setNotice(null) }} className={`rounded-lg py-2 font-medium transition ${mode === 'login' ? 'surface shadow-sm' : 'text-faint'}`}>{t('登录', 'Sign in')}</button>
            <button aria-pressed={mode === 'register'} onClick={() => { setMode('register'); setError(null); setNotice(null) }} className={`rounded-lg py-2 font-medium transition ${mode === 'register' ? 'surface shadow-sm' : 'text-faint'}`}>{t('注册', 'Register')}</button>
          </div>
          )}

          {emailMode ? (
            <form onSubmit={emailCodeSent ? verifyEmailCode : sendEmailCode} className="flex flex-col gap-4">
              <div>
                <h2 className="text-base font-semibold">{t('邮箱验证码登录', 'Sign in with an email code')}</h2>
                <p className="mt-1 text-sm text-soft">
                  {t('免密码：验证码发到你的邮箱，输入即登录。未注册的邮箱会自动创建新账号。',
                    "No password needed — we'll email you a code. A new account is created automatically for unregistered emails.")}
                </p>
              </div>
              <Field label={t('邮箱', 'Email')}>
                <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" autoCapitalize="none" required readOnly={emailCodeSent} placeholder={t('you@example.com', 'you@example.com')} />
              </Field>
              {emailCodeSent && (
                <Field label={t('验证码', 'Code')}>
                  <Input value={emailCode} onChange={(e) => setEmailCode(e.target.value)} autoComplete="one-time-code" required placeholder="123456" />
                </Field>
              )}
              {emailTotp && (
                <Field label={t('两步验证码 / 恢复码', '2FA code / recovery code')} hint={t('该账号开启了两步验证', 'This account has two-factor enabled')}>
                  <Input value={totpCode} onChange={(e) => setTotpCode(e.target.value)} autoComplete="one-time-code" autoCapitalize="characters" required placeholder="123456" />
                </Field>
              )}
              {notice && <div className="rounded-xl bg-ok/10 px-3 py-2 text-sm text-ok" role="status">{notice}</div>}
              {error && <div className="rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">{error}</div>}
              <Button type="submit" loading={busy} className="mt-1 w-full py-3 text-base">
                {emailCodeSent ? t('验证并登录', 'Verify & sign in') : t('发送验证码', 'Send code')}
              </Button>
              {emailCodeSent && (
                <button type="button" onClick={(e) => { setEmailCodeSent(false); setEmailCode(''); setEmailTotp(false); void sendEmailCode(e as unknown as React.FormEvent) }} className="text-sm text-faint hover:text-soft">
                  {t('重新发送验证码', 'Resend code')}
                </button>
              )}
              <button type="button" onClick={leaveEmailMode} className="text-sm text-faint hover:text-soft">{t('返回密码登录', 'Back to password sign-in')}</button>
            </form>
          ) : forgot ? (
            <form onSubmit={codeSent ? doReset : sendResetCode} className="flex flex-col gap-4">
              <div>
                <h2 className="text-base font-semibold">{t('找回密码', 'Reset password')}</h2>
                <p className="mt-1 text-sm text-soft">{t('输入账号，我们会向你绑定的已验证邮箱发送验证码。', "Enter your account — we'll email a code to your verified address.")}</p>
              </div>
              <Field label={t('用户名 / 邮箱 / 手机号', 'Username / Email / Phone')}>
                <Input value={identifier} onChange={(e) => setIdentifier(e.target.value)} autoComplete="username" autoCapitalize="none" required readOnly={codeSent} placeholder={t('请输入账号', 'Your account')} />
              </Field>
              {codeSent && (
                <>
                  <Field label={t('验证码', 'Code')}>
                    <Input value={resetCode} onChange={(e) => setResetCode(e.target.value)} autoComplete="one-time-code" required placeholder="123456" />
                  </Field>
                  <Field label={t('新密码', 'New password')} hint={t('至少 8 位', 'At least 8 characters')}>
                    <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" required minLength={8} placeholder={t('设置新密码', 'Set a new password')} />
                  </Field>
                </>
              )}
              {notice && <div className="rounded-xl bg-ok/10 px-3 py-2 text-sm text-ok" role="status">{notice}</div>}
              {error && <div className="rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">{error}</div>}
              <Button type="submit" loading={busy} className="mt-1 w-full py-3 text-base">{codeSent ? t('重置密码', 'Reset password') : t('发送验证码', 'Send code')}</Button>
              <button type="button" onClick={leaveForgot} className="text-sm text-faint hover:text-soft">{t('返回登录', 'Back to sign in')}</button>
            </form>
          ) : twoFA ? (
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
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required minLength={mode === 'login' ? 1 : 8} placeholder={t('请输入密码', 'Your password')} />
            </Field>

            {notice && <div className="rounded-xl bg-ok/10 px-3 py-2 text-sm text-ok" role="status">{notice}</div>}
            {error && <div className="rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger" role="alert">{error}</div>}

            <Button type="submit" loading={busy} className="mt-1 w-full py-3 text-base">{mode === 'login' ? t('登录', 'Sign in') : t('创建账户', 'Create account')}</Button>
            {mode === 'login' && passkeySupported() && (
              /* 通行密钥登录（可发现凭据）：无需先输账号——浏览器列出本站已存的 passkey，
                 指纹/面容确认即登录。UV 强制（服务端 requireUserVerification），等价满足两步验证。 */
              <Button type="button" variant="soft" loading={pkBusy} onClick={() => void passkeyLogin()} className="w-full py-3 text-base">
                🔑 {t('用通行密钥登录', 'Sign in with a passkey')}
              </Button>
            )}
            {mode === 'login' && (
              <Button type="button" variant="soft" onClick={() => { setEmailMode(true); setError(null); setNotice(null) }} className="w-full py-3 text-base">
                ✉️ {t('邮箱验证码登录', 'Sign in with an email code')}
              </Button>
            )}
            {mode === 'login' && (
              <button type="button" onClick={() => { setForgot(true); setError(null); setNotice(null) }} className="text-center text-sm text-accent hover:underline">{t('忘记密码？', 'Forgot password?')}</button>
            )}
          </form>
          )}
        </div>

        <p className="mt-6 text-center text-xs leading-relaxed text-faint">
          {t('继续即表示同意', 'By continuing you agree to our ')}
          <a className="text-accent hover:underline" href="https://beeurei.hikosphere.com/legal/" target="_blank" rel="noreferrer">{t('隐私政策与条款', 'Privacy & Terms')}</a>。
          <br />{t('视障用户请使用 iOS 客户端。', 'Blind users: please use the iOS app.')}
          {/* 官网→网页版的漏斗回环：冷访客从官网点进来只见登录表单，给一条回官网了解产品的路（新标签，登录进度不丢）。 */}
          <br /><a className="text-accent hover:underline" href="https://beeurei.hikosphere.com/" target="_blank" rel="noreferrer">{t('了解 BeeUrEi 是什么 →', 'Learn what BeeUrEi is →')}</a>
        </p>
      </div>
    </div>
  )
}
