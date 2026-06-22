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
        <Button variant="soft" onClick={() => setPwOpen(true)}>{t('修改密码', 'Change password')}</Button>
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
