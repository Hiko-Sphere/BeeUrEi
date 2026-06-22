import { useEffect, useState } from 'react'
import { api, APIError, type SelfView } from '../lib/api'
import { useSession } from '../lib/session'
import { useI18n } from '../lib/i18n'
import { roleLabel } from '../components/Layout'
import { Card, Avatar, Button, Field, Input, useToast } from '../components/ui'

export function AccountPage() {
  const { user, refreshMe, signOut } = useSession()
  const { t, lang, setLang } = useI18n()
  const toast = useToast()
  const [self, setSelf] = useState<SelfView | null>(null)
  const [displayName, setDisplayName] = useState('')
  const [savingName, setSavingName] = useState(false)
  const [pwOpen, setPwOpen] = useState(false)
  const [tfaOpen, setTfaOpen] = useState(false)

  useEffect(() => { void api.me().then((m) => { setSelf(m); setDisplayName(m.displayName) }).catch(() => {}) }, [])

  const saveName = async () => {
    const name = displayName.trim()
    if (!name || name === self?.displayName) return
    setSavingName(true)
    try { await api.setProfile(name); await refreshMe(); setSelf((s) => s ? { ...s, displayName: name } : s); toast(t('已保存', 'Saved'), 'ok') }
    catch { toast(t('保存失败', 'Failed'), 'error') } finally { setSavingName(false) }
  }

  const changeRole = async (role: 'helper' | 'family') => {
    if (role === self?.role) return
    try { await api.setRole(role); await refreshMe(); setSelf((s) => s ? { ...s, role } : s); toast(t('身份已更新', 'Role updated'), 'ok') }
    catch (e) { toast(e instanceof APIError && e.code === 'role_not_self_service' ? t('该身份不可自助切换', 'Role not switchable') : t('切换失败', 'Failed'), 'error') }
  }

  const changeLang = async (l: 'zh' | 'en') => {
    setLang(l)
    try { await api.setLanguage(l === 'zh' ? 'zh-Hans' : 'en') } catch { /* 本地已切换即可 */ }
  }

  const removeAccount = async () => {
    if (!confirm(t('确定永久注销账户？此操作不可撤销，将删除你的资料与关系。', 'Permanently delete your account? This cannot be undone.'))) return
    try { await api.deleteAccount(); toast(t('账户已注销', 'Account deleted')); signOut() } catch { toast(t('注销失败', 'Failed'), 'error') }
  }

  if (!user) return null

  return (
    <div className="flex max-w-2xl flex-col gap-5">
      <h1 className="text-2xl font-bold tracking-tight">{t('账户', 'Account')}</h1>

      {/* 资料 */}
      <Card className="p-5">
        <div className="flex items-center gap-4">
          <Avatar name={user.displayName} src={user.avatar} size={64} />
          <div className="min-w-0">
            <div className="truncate text-lg font-semibold">{user.displayName}</div>
            <div className="truncate text-sm text-faint">@{user.username} · {roleLabel(user.role, t)}</div>
            {self?.email && <div className="truncate text-xs text-faint">{self.email}</div>}
          </div>
        </div>
        <div className="mt-5">
          <Field label={t('显示名称', 'Display name')}>
            <div className="flex gap-2">
              <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={40} />
              <Button className="shrink-0" loading={savingName} onClick={saveName} disabled={!displayName.trim() || displayName.trim() === self?.displayName}>{t('保存', 'Save')}</Button>
            </div>
          </Field>
        </div>
      </Card>

      {/* 身份 */}
      {['helper', 'family'].includes(user.role) && (
        <Card className="p-5">
          <div className="mb-3 text-sm font-semibold">{t('身份', 'Role')}</div>
          <div className="grid grid-cols-2 gap-2">
            {(['helper', 'family'] as const).map((r) => (
              <button key={r} onClick={() => changeRole(r)}
                className={`rounded-xl border px-3 py-2.5 text-sm font-medium transition ${self?.role === r ? 'border-honey bg-honey/10' : 'border-[var(--line)] text-soft'}`}>
                {r === 'helper' ? t('志愿者', 'Volunteer') : t('亲友', 'Family')}
              </button>
            ))}
          </div>
        </Card>
      )}

      {/* 语言 */}
      <Card className="p-5">
        <div className="mb-3 text-sm font-semibold">{t('界面语言', 'Language')}</div>
        <div className="grid grid-cols-2 gap-2">
          {(['zh', 'en'] as const).map((l) => (
            <button key={l} onClick={() => changeLang(l)}
              className={`rounded-xl border px-3 py-2.5 text-sm font-medium transition ${lang === l ? 'border-honey bg-honey/10' : 'border-[var(--line)] text-soft'}`}>
              {l === 'zh' ? '简体中文' : 'English'}
            </button>
          ))}
        </div>
      </Card>

      {/* 安全 */}
      <Card className="p-5">
        <div className="mb-3 text-sm font-semibold">{t('安全', 'Security')}</div>
        <div className="flex flex-wrap gap-2">
          <Button variant="soft" onClick={() => setPwOpen(true)}>{t('修改密码', 'Change password')}</Button>
          <Button variant="soft" onClick={() => setTfaOpen(true)}>
            {t('两步验证', 'Two-factor')}
            <span className="ml-1.5 text-xs text-faint">{self?.twoFactorEnabled ? t('已开启', 'On') : t('未开启', 'Off')}</span>
          </Button>
        </div>
      </Card>

      {/* 危险区 */}
      <Card className="border-danger/30 p-5">
        <div className="mb-1 text-sm font-semibold text-danger">{t('危险操作', 'Danger zone')}</div>
        <p className="mb-3 text-xs text-faint">{t('退出登录或永久注销账户。', 'Sign out or permanently delete your account.')}</p>
        <div className="flex gap-2">
          <Button variant="soft" onClick={() => { if (confirm(t('确定退出登录？', 'Sign out?'))) signOut() }}>{t('退出登录', 'Sign out')}</Button>
          <Button variant="danger" onClick={removeAccount}>{t('注销账户', 'Delete account')}</Button>
        </div>
      </Card>

      {pwOpen && <PasswordDialog onClose={() => setPwOpen(false)} />}
      {tfaOpen && <TwoFactorDialog onClose={() => setTfaOpen(false)} onChanged={async () => { await refreshMe(); try { setSelf(await api.me()) } catch { /* ignore */ } }} />}
    </div>
  )
}

/// 两步验证管理弹窗：未开启→显示密钥(可复制 + otpauth 链接) + 输码开启 + 展示一次性恢复码；
/// 已开启→剩余码数 / 重新生成 / 关闭（均需再次验证）。
function TwoFactorDialog({ onClose, onChanged }: { onClose: () => void; onChanged: () => void }) {
  const { t } = useI18n()
  const toast = useToast()
  const [status, setStatus] = useState<{ enabled: boolean; recoveryCodesRemaining: number } | null>(null)
  const [setup, setSetup] = useState<{ secret: string; otpauthUri: string } | null>(null)
  const [enableCode, setEnableCode] = useState('')
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => { void api.twoFAStatus().then(setStatus).catch(() => setStatus({ enabled: false, recoveryCodesRemaining: 0 })) }, [])

  const copy = (text: string, label: string) => { void navigator.clipboard.writeText(text).then(() => toast(label, 'ok')).catch(() => {}) }
  const codeErr = (e: unknown) => setErr(e instanceof APIError && e.code === 'invalid_code' ? t('验证码不对，请重试', "That code didn't work — try again") : t('操作失败，请重试', 'Something went wrong'))

  const beginSetup = async () => { setBusy(true); setErr(null); try { setSetup(await api.twoFASetup()); setEnableCode('') } catch { setErr(t('操作失败，请重试', 'Something went wrong')) } finally { setBusy(false) } }
  const confirmEnable = async () => {
    setBusy(true); setErr(null)
    try { const r = await api.twoFAEnable(enableCode.trim()); setSetup(null); setRecoveryCodes(r.recoveryCodes); toast(t('两步验证已开启', 'Two-factor is on'), 'ok'); onChanged() }
    catch (e) { codeErr(e) } finally { setBusy(false) }
  }
  const disable = async () => {
    const code = prompt(t('输入当前验证码或一个恢复码以关闭两步验证', 'Enter a current code or a recovery code to turn off two-factor'))
    if (!code) return
    setBusy(true); setErr(null)
    try { await api.twoFADisable(code.trim()); toast(t('两步验证已关闭', 'Two-factor is off'), 'ok'); onChanged(); setStatus({ enabled: false, recoveryCodesRemaining: 0 }) }
    catch (e) { codeErr(e) } finally { setBusy(false) }
  }
  const regenerate = async () => {
    const code = prompt(t('输入当前验证码或一个恢复码以重新生成', 'Enter a current code or a recovery code to regenerate'))
    if (!code) return
    setBusy(true); setErr(null)
    try { const r = await api.twoFARecovery(code.trim()); setRecoveryCodes(r.recoveryCodes) }
    catch (e) { codeErr(e) } finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-[120] grid place-items-center bg-black/50 p-4" onClick={onClose}>
      <div className="slide-up w-full max-w-sm rounded-2xl surface border border-[var(--line)] p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold">{t('两步验证', 'Two-factor authentication')}</h3>

        {recoveryCodes ? (
          <div className="mt-4 flex flex-col gap-3">
            <p className="text-sm text-soft">{t('把这些一次性恢复码存到安全的地方。丢失验证器时，每个码可代替验证码登录一次。关闭后将不再显示。', 'Save these one-time recovery codes somewhere safe. Each signs you in once if you lose your authenticator. They won’t be shown again.')}</p>
            <pre className="rounded-xl surface-2 p-3 text-sm leading-7 tracking-wider">{recoveryCodes.join('\n')}</pre>
            <div className="flex gap-2">
              <Button variant="soft" className="flex-1" onClick={() => copy(recoveryCodes.join('\n'), t('恢复码已复制', 'Recovery codes copied'))}>{t('全部复制', 'Copy all')}</Button>
              <Button className="flex-1" onClick={onClose}>{t('完成', 'Done')}</Button>
            </div>
          </div>
        ) : setup ? (
          <div className="mt-4 flex flex-col gap-4">
            <p className="text-sm text-soft">{t('把下面的密钥添加到身份验证器 App（如 Google Authenticator、1Password）。', 'Add the key below to an authenticator app (e.g. Google Authenticator, 1Password).')}</p>
            <div>
              <div className="mb-1 text-xs text-faint">{t('密钥', 'Key')}</div>
              <code className="block break-all rounded-xl surface-2 p-3 text-sm tracking-wider">{setup.secret}</code>
              <div className="mt-2 flex gap-2">
                <Button variant="soft" onClick={() => copy(setup.secret, t('密钥已复制', 'Key copied'))}>{t('复制密钥', 'Copy key')}</Button>
                <a className="rounded-xl border border-[var(--line)] px-3 py-2 text-sm text-soft hover:surface-2" href={setup.otpauthUri}>{t('添加到 App', 'Add to app')}</a>
              </div>
            </div>
            <Field label={t('验证器显示的 6 位验证码', '6-digit code from your authenticator')}>
              <Input value={enableCode} onChange={(e) => setEnableCode(e.target.value)} inputMode="numeric" autoComplete="one-time-code" placeholder="123456" />
            </Field>
            {err && <div className="rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger">{err}</div>}
            <div className="flex gap-2">
              <Button variant="soft" className="flex-1" onClick={() => setSetup(null)}>{t('取消', 'Cancel')}</Button>
              <Button className="flex-1" loading={busy} onClick={confirmEnable} disabled={enableCode.trim().length < 6}>{t('确认开启', 'Turn on')}</Button>
            </div>
          </div>
        ) : status === null ? (
          <p className="mt-4 text-sm text-faint">{t('加载中…', 'Loading…')}</p>
        ) : status.enabled ? (
          <div className="mt-4 flex flex-col gap-3">
            <p className="text-sm text-soft">{t('已开启。登录时除密码外还需输入验证器的验证码。', 'On. Signing in requires a code from your authenticator in addition to your password.')}</p>
            <p className="text-xs text-faint">{t(`剩余 ${status.recoveryCodesRemaining} 个恢复码`, `${status.recoveryCodesRemaining} recovery codes left`)}</p>
            {err && <div className="rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger">{err}</div>}
            <div className="flex flex-col gap-2">
              <Button variant="soft" loading={busy} onClick={regenerate}>{t('重新生成恢复码', 'Regenerate recovery codes')}</Button>
              <Button variant="danger" loading={busy} onClick={disable}>{t('关闭两步验证', 'Turn off two-factor')}</Button>
              <Button variant="soft" onClick={onClose}>{t('完成', 'Done')}</Button>
            </div>
          </div>
        ) : (
          <div className="mt-4 flex flex-col gap-3">
            <p className="text-sm text-soft">{t('开启后，登录时除密码外还需输入身份验证器 App 的验证码——即使密码泄露也更安全。', 'When on, signing in needs a code from your authenticator app in addition to your password — safer even if your password leaks.')}</p>
            {err && <div className="rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger">{err}</div>}
            <div className="flex gap-2">
              <Button variant="soft" className="flex-1" onClick={onClose}>{t('取消', 'Cancel')}</Button>
              <Button className="flex-1" loading={busy} onClick={beginSetup}>{t('开启两步验证', 'Turn on')}</Button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function PasswordDialog({ onClose }: { onClose: () => void }) {
  const { t } = useI18n()
  const toast = useToast()
  const { signOut } = useSession()
  const [oldPw, setOldPw] = useState('')
  const [newPw, setNewPw] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    if (newPw.length < 6) { toast(t('新密码至少 6 位', 'At least 6 characters'), 'error'); return }
    setBusy(true)
    try {
      await api.setPassword(oldPw, newPw)
      toast(t('密码已修改，请重新登录', 'Password changed, please sign in again'), 'ok')
      onClose(); signOut() // 改密会吊销现有令牌
    } catch (e) { toast(e instanceof APIError && e.code === 'invalid_credentials' ? t('原密码不正确', 'Wrong current password') : t('修改失败', 'Failed'), 'error') }
    finally { setBusy(false) }
  }
  return (
    <div className="fixed inset-0 z-[120] grid place-items-center bg-black/50 p-4" onClick={onClose}>
      <div className="slide-up w-full max-w-sm rounded-2xl surface border border-[var(--line)] p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold">{t('修改密码', 'Change password')}</h3>
        <div className="mt-4 flex flex-col gap-4">
          <Field label={t('当前密码', 'Current password')}><Input type="password" value={oldPw} onChange={(e) => setOldPw(e.target.value)} autoComplete="current-password" /></Field>
          <Field label={t('新密码', 'New password')} hint={t('至少 6 位', 'At least 6 characters')}><Input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} autoComplete="new-password" /></Field>
        </div>
        <div className="mt-5 flex gap-3">
          <Button variant="soft" className="flex-1" onClick={onClose}>{t('取消', 'Cancel')}</Button>
          <Button className="flex-1" loading={busy} onClick={submit} disabled={!oldPw || !newPw}>{t('确认修改', 'Confirm')}</Button>
        </div>
      </div>
    </div>
  )
}
