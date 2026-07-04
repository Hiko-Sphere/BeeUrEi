import { useEffect, useState } from 'react'
import { apiURL } from '../lib/config'
import { api, tokenStore, APIError, contentBlockedText, reencodeToJpeg, uploadVerificationDoc, type SelfView, type SessionInfo, type VerificationStatusInfo } from '../lib/api'
import { useSession } from '../lib/session'
import { useI18n } from '../lib/i18n'
import { subscribeWebPush, unsubscribeWebPush, isWebPushSubscribed, webPushSupported, resyncWebPushSubscription } from '../lib/webPush'
import { roleLabel } from '../components/Layout'
import { Card, Avatar, Button, Field, Input, useToast, Modal } from '../components/ui'

export function AccountPage() {
  const { user, refreshMe, signOut } = useSession()
  const { t, lang, setLang } = useI18n()
  const toast = useToast()
  // 数据导出：authed fetch → blob 存文件（走 api() 会被 JSON 解析——下载语义直接取字节）。
  const exportMyData = async () => {
    try {
      const res = await fetch(apiURL('/api/account/export'), { headers: { authorization: `Bearer ${tokenStore.token}` } })
      if (!res.ok) throw new Error(String(res.status))
      const blob = await res.blob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a'); a.href = url; a.download = 'beeurei-my-data.json'
      document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url)
      toast(t('已导出', 'Exported'), 'ok')
    } catch { toast(t('导出失败，请稍后再试', 'Export failed — try again later'), 'error') }
  }
  const [self, setSelf] = useState<SelfView | null>(null)
  const [displayName, setDisplayName] = useState('')
  const [savingName, setSavingName] = useState(false)
  const [pwOpen, setPwOpen] = useState(false)
  const [tfaOpen, setTfaOpen] = useState(false)
  const [sessionsOpen, setSessionsOpen] = useState(false)
  const [emailOpen, setEmailOpen] = useState(false)
  const [idOpen, setIdOpen] = useState(false)
  const [verifOpen, setVerifOpen] = useState(false)
  const [verif, setVerif] = useState<VerificationStatusInfo | null>(null)

  const reloadVerif = async () => { try { setVerif(await api.verificationStatus()) } catch { /* ignore */ } }
  useEffect(() => { void api.me().then((m) => { setSelf(m); setDisplayName(m.displayName) }).catch(() => {}); void reloadVerif() }, [])

  const verifLabel = (s?: string) => s === 'verified' ? t('已认证', 'Verified')
    : s === 'pending' ? t('审核中', 'Pending')
    : s === 'rejected' ? t('未通过', 'Not approved')
    : t('未认证', 'Not verified')

  const saveName = async () => {
    const name = displayName.trim()
    if (!name || name === self?.displayName) return
    setSavingName(true)
    try { await api.setProfile(name); await refreshMe(); setSelf((s) => s ? { ...s, displayName: name } : s); toast(t('已保存', 'Saved'), 'ok') }
    catch (e) { toast(contentBlockedText(e, t, t('保存失败', 'Failed')), 'error') } finally { setSavingName(false) }
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
            <div className="flex items-center gap-1.5">
              <span className="truncate text-lg font-semibold">{user.displayName}</span>
              {(self?.verified || verif?.status === 'verified') && (
                <span title={t('已实名认证', 'Identity verified')} className="inline-flex items-center gap-0.5 rounded-full bg-honey/15 px-1.5 py-0.5 text-[10px] font-bold text-accent">✓ {t('已认证', 'Verified')}</span>
              )}
            </div>
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

      {/* 浏览器通知（Web Push）：关掉标签页也能收到紧急告警的系统通知 */}
      <WebPushCard />

      {/* 安全 */}
      <Card className="p-5">
        <div className="mb-3 text-sm font-semibold">{t('安全', 'Security')}</div>
        <div className="flex flex-wrap gap-2">
          <Button variant="soft" onClick={() => setIdOpen(true)}>
            {t('用户名 / 手机号', 'Username / phone')}
            {self?.usernameCustomized === false && <span className="ml-1.5 text-xs text-accent">{t('待设置', 'Set up')}</span>}
          </Button>
          <Button variant="soft" onClick={() => setPwOpen(true)}>{t('修改密码', 'Change password')}</Button>
          <Button variant="soft" onClick={() => setEmailOpen(true)}>
            {self?.email ? t('邮箱', 'Email') : t('绑定邮箱', 'Add email')}
            <span className="ml-1.5 text-xs text-faint">{!self?.email ? t('未绑定', 'None') : self.emailVerified ? t('已验证', 'Verified') : t('未验证', 'Unverified')}</span>
          </Button>
          <Button variant="soft" onClick={() => setTfaOpen(true)}>
            {t('两步验证', 'Two-factor')}
            <span className="ml-1.5 text-xs text-faint">{self?.twoFactorEnabled ? t('已开启', 'On') : t('未开启', 'Off')}</span>
          </Button>
          <Button variant="soft" onClick={() => setSessionsOpen(true)}>{t('登录设备', 'Devices')}</Button>
          <Button variant="soft" onClick={() => setVerifOpen(true)}>
            {t('实名认证', 'Identity')}
            <span className="ml-1.5 text-xs text-faint">{verifLabel(verif?.status)}</span>
          </Button>
        </div>
      </Card>

      {/* 我的数据（GDPR 可携权：不求人拿走自己的数据） */}
      <Card className="p-5">
        <div className="mb-1 text-sm font-semibold">{t('我的数据', 'My data')}</div>
        <p className="mb-3 text-xs text-faint">{t('导出你的档案、亲友关系、路线与你发出的消息（JSON）。不含他人的消息内容。', 'Export your profile, contacts, routes and messages you sent (JSON). Never includes others\u2019 messages.')}</p>
        <Button variant="soft" onClick={() => void exportMyData()}>{t('导出我的数据', 'Export my data')}</Button>
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
      {sessionsOpen && <SessionsDialog onClose={() => setSessionsOpen(false)} />}
      {emailOpen && <EmailDialog currentEmail={self?.email ?? null} verified={self?.emailVerified ?? false} onClose={() => setEmailOpen(false)} onChanged={async () => { await refreshMe(); try { setSelf(await api.me()) } catch { /* ignore */ } }} />}
      {idOpen && <IdentityDialog currentUsername={user.username} currentPhone={self?.phone ?? null} onClose={() => setIdOpen(false)} onChanged={async () => { await refreshMe(); try { setSelf(await api.me()) } catch { /* ignore */ } }} />}
      {verifOpen && <VerificationDialog status={verif} onClose={() => setVerifOpen(false)} onChanged={async () => { await reloadVerif(); await refreshMe(); try { setSelf(await api.me()) } catch { /* ignore */ } }} />}
    </div>
  )
}

const KYC_CONSENT_VERSION = 'kyc-1'
const ID_TYPES: { value: string; zh: string; en: string }[] = [
  { value: 'national_id', zh: '身份证', en: 'National ID' },
  { value: 'passport', zh: '护照', en: 'Passport' },
  { value: 'drivers_license', zh: '驾照', en: "Driver's license" },
  { value: 'residence_permit', zh: '居住证', en: 'Residence permit' },
]
const REJECT_REASONS: Record<string, [string, string]> = {
  blurry: ['照片模糊，请在光线充足处重拍。', 'The photo was blurry — retake in good lighting.'],
  glare: ['照片反光，请避开强光重拍。', 'The photo had glare — retake without reflections.'],
  name_mismatch: ['姓名与证件不一致，请核对后重新提交。', 'Name did not match — check and resubmit.'],
  face_mismatch: ['自拍与证件不匹配，请本人重新拍摄。', 'Selfie did not match — retake it yourself.'],
  expired: ['证件已过期，请使用有效证件。', 'The document has expired.'],
  unsupported_doc: ['证件类型不被支持。', 'Document type not supported.'],
  incomplete: ['资料不完整，请补齐。', 'Submission incomplete.'],
  suspected_fraud: ['审核未通过。', 'Verification was not approved.'],
  timeout: ['超过审核时限已关闭，请重新提交。', 'Timed out — please resubmit.'],
  revoked: ['实名认证已被撤销。', 'Verification was revoked.'],
  other: ['审核未通过，请重新提交。', 'Not approved — please resubmit.'],
}

/// 实名认证弹窗：展示状态，或引导提交（同意 → 填实名+证件类型 → 上传证件正面+自拍 → 提交人工审核）。
/// 隐私：图片在浏览器内经 canvas 重编码为 JPEG（剥 EXIF/GPS）再上传；提交后不可取回原图。
export function VerificationDialog({ status, onClose, onChanged }: { status: VerificationStatusInfo | null; onClose: () => void; onChanged: () => void }) {
  const { t, lang } = useI18n()
  const toast = useToast()
  const [step, setStep] = useState<'status' | 'consent' | 'form'>('status')
  const [legalName, setLegalName] = useState('')
  const [idType, setIdType] = useState('national_id')
  const [idLast4, setIdLast4] = useState('')
  const [frontFile, setFrontFile] = useState<File | null>(null)
  const [selfieFile, setSelfieFile] = useState<File | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const st = status?.status ?? 'none'
  const canStart = st === 'none' || st === 'rejected'

  const submit = async () => {
    setErr(null)
    if (!legalName.trim()) { setErr(t('请填写证件上的法定姓名', 'Enter your legal name as on the document')); return }
    if (!/^[0-9A-Za-z]{4}$/.test(idLast4)) { setErr(t('请填写证件号后 4 位', 'Enter the last 4 of the ID number')); return }
    if (!frontFile || !selfieFile) { setErr(t('请上传证件正面与本人自拍', 'Upload the document front and a selfie')); return }
    setBusy(true)
    try {
      const { id } = await api.submitVerification({ legalName: legalName.trim(), idType, idNumberLast4: idLast4, consentVersion: KYC_CONSENT_VERSION })
      const front = await reencodeToJpeg(frontFile)
      const selfie = await reencodeToJpeg(selfieFile)
      await uploadVerificationDoc(id, 'front', front)
      await uploadVerificationDoc(id, 'selfie', selfie)
      toast(t('已提交，等待人工审核', 'Submitted — pending review'), 'ok')
      await onChanged()
      onClose()
    } catch (e) {
      const code = e instanceof APIError ? e.code : ''
      setErr(code === 'already_pending' ? t('已有一份待审核的申请', 'You already have a pending submission')
        : code === 'already_verified' ? t('你已通过实名认证', 'You are already verified')
        : code === 'image_decode_failed' ? t('图片无法读取，请换一张', 'Could not read the image — try another')
        : t('提交失败，请重试', 'Submission failed — please try again'))
    } finally { setBusy(false) }
  }

  return (
    <Modal onClose={onClose} label={t('实名认证', 'Identity verification')} panelClassName="max-h-[88dvh] w-full max-w-md overflow-auto">
        <h3 className="text-lg font-semibold">{t('实名认证', 'Identity verification')}</h3>

        {step === 'status' && (
          <div className="mt-3 flex flex-col gap-3">
            {st === 'verified' && <p className="rounded-xl bg-honey/10 p-3 text-sm text-accent">✓ {t('你已通过实名认证，账号已显示「已认证」徽章。', 'You are verified — the verified badge appears on your account.')}</p>}
            {st === 'pending' && <p className="rounded-xl surface-2 p-3 text-sm text-soft">{t('审核中，通常 1–2 个工作日。结果会通过通知告知你。', 'Under review, usually 1–2 business days. We will notify you of the result.')}</p>}
            {st === 'rejected' && (
              <p className="rounded-xl border border-danger/30 p-3 text-sm text-soft">
                {t('上次未通过：', 'Last attempt was not approved: ')}
                {(REJECT_REASONS[status?.rejectReasonCode ?? 'other'] ?? REJECT_REASONS.other)[lang === 'en' ? 1 : 0]}
              </p>
            )}
            {st === 'none' && <p className="text-sm text-faint">{t('通过实名认证可获得「已认证」徽章，让联系人更信任你。', 'Verify your identity to earn a trusted badge your contacts can see.')}</p>}
            <div className="mt-2 flex gap-3">
              {canStart && <Button className="flex-1" onClick={() => setStep('consent')}>{st === 'rejected' ? t('重新提交', 'Resubmit') : t('开始认证', 'Start')}</Button>}
              <Button variant="soft" className="flex-1" onClick={onClose}>{t('完成', 'Done')}</Button>
            </div>
          </div>
        )}

        {step === 'consent' && (
          <div className="mt-3 flex flex-col gap-3 text-sm text-soft">
            <p>{t('我们会收集你的：法定姓名、一张政府证件、一张本人自拍。', 'We collect: your legal name, one government ID, and a selfie.')}</p>
            <ul className="list-disc space-y-1 pl-5 text-faint">
              <li>{t('由人工审核员核对是否为你本人——非自动通过。', 'A human reviewer confirms it is you — never auto-approved.')}</li>
              <li>{t('证件以 AES-256 加密存储，仅审核员可见，每次访问都留痕。', 'Documents are AES-256 encrypted, visible only to reviewers, every access is logged.')}</li>
              <li>{t('审核完成后证件图片会按留存策略删除。', 'Document images are deleted per our retention policy after review.')}</li>
            </ul>
            <div className="mt-2 flex gap-3">
              <Button className="flex-1" onClick={() => setStep('form')}>{t('我同意并继续', 'I agree & continue')}</Button>
              <Button variant="soft" className="flex-1" onClick={() => setStep('status')}>{t('返回', 'Back')}</Button>
            </div>
          </div>
        )}

        {step === 'form' && (
          <div className="mt-3 flex flex-col gap-3">
            <Field label={t('证件上的法定姓名', 'Legal name on document')}>
              <Input value={legalName} onChange={(e) => setLegalName(e.target.value)} maxLength={120} />
            </Field>
            <Field label={t('证件类型', 'Document type')}>
              <select value={idType} onChange={(e) => setIdType(e.target.value)} className="w-full rounded-xl border border-[var(--line)] surface-2 px-3 py-2.5 text-sm">
                {ID_TYPES.map((o) => <option key={o.value} value={o.value}>{lang === 'en' ? o.en : o.zh}</option>)}
              </select>
            </Field>
            <Field label={t('证件号后 4 位', 'Last 4 of ID number')}>
              <Input value={idLast4} onChange={(e) => setIdLast4(e.target.value.replace(/[^0-9A-Za-z]/g, '').slice(0, 4))} maxLength={4} />
            </Field>
            <DocPicker label={t('证件正面照片', 'Document front photo')} capture="environment" file={frontFile} onPick={setFrontFile} t={t} />
            <DocPicker label={t('本人自拍', 'Selfie')} capture="user" file={selfieFile} onPick={setSelfieFile} t={t} />
            {err && <p className="text-sm text-danger">{err}</p>}
            <div className="mt-1 flex gap-3">
              <Button className="flex-1" loading={busy} onClick={submit}>{t('提交审核', 'Submit for review')}</Button>
              <Button variant="soft" className="flex-1" onClick={() => setStep('consent')}>{t('返回', 'Back')}</Button>
            </div>
          </div>
        )}
    </Modal>
  )
}

function DocPicker({ label, capture, file, onPick, t }: { label: string; capture: 'environment' | 'user'; file: File | null; onPick: (f: File | null) => void; t: (zh: string, en: string) => string }) {
  return (
    // 不能用 Field：Field 是 <label>，而内层可点选区也是 <label>——嵌套 <label> 是非法 HTML，
    // 关联会错乱。改为 div + 描述性 span；文件 input 用 aria-label 命名（读屏听到"证件正面照片"等）。
    <div>
      <span className="mb-1.5 block text-sm font-medium text-soft">{label}</span>
      <label className="flex cursor-pointer items-center gap-3 rounded-xl border border-dashed border-[var(--line)] surface-2 px-3 py-3 text-sm text-soft">
        <span className="text-lg">📷</span>
        <span className="flex-1 truncate">{file ? file.name : t('点击选择 / 拍摄', 'Tap to choose / capture')}</span>
        {file && <span className="text-honey">✓</span>}
        <input type="file" accept="image/*" capture={capture} aria-label={label} className="hidden" onChange={(e) => onPick(e.target.files?.[0] ?? null)} />
      </label>
    </div>
  )
}

/// 登录设备 / 会话管理弹窗：列出各设备，可远程登出某台或「其它所有设备」。
function SessionsDialog({ onClose }: { onClose: () => void }) {
  const { t } = useI18n()
  const toast = useToast()
  const [sessions, setSessions] = useState<SessionInfo[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const reload = async () => { try { setSessions((await api.sessions()).sessions) } catch { setSessions([]) } }
  useEffect(() => { void reload() }, [])

  const lastSeen = (ms?: number) => {
    if (!ms) return t('活动时间未知', 'Last active: unknown')
    const s = Math.max(0, (Date.now() - ms) / 1000)
    if (s < 60) return t('最近活动：刚刚', 'Active just now')
    if (s < 3600) return t(`最近活动：${Math.floor(s / 60)} 分钟前`, `Active ${Math.floor(s / 60)} min ago`)
    if (s < 86400) return t(`最近活动：${Math.floor(s / 3600)} 小时前`, `Active ${Math.floor(s / 3600)} h ago`)
    return t(`最近活动：${Math.floor(s / 86400)} 天前`, `Active ${Math.floor(s / 86400)} d ago`)
  }
  const revoke = async (id: string) => { setBusy(id); try { await api.revokeSession(id); await reload(); toast(t('已登出该设备', 'Device signed out'), 'ok') } catch { toast(t('操作失败', 'Failed'), 'error') } finally { setBusy(null) } }
  const revokeOthers = async () => {
    if (!confirm(t('除这台外，其它所有设备都会被立即登出。继续？', 'All devices except this one will be signed out immediately. Continue?'))) return
    setBusy('others')
    try {
      // 本浏览器的推送订阅端点：其它设备的订阅会被服务端连带清掉（被盗设备不再收告警/消息通知），
      // 本浏览器的凭 keepEndpoint 保留。取不到（无 SW/未订阅）就不带——全清后本页自愈重订。
      let keep: string | undefined
      try { keep = (await (await navigator.serviceWorker?.getRegistration('/app/sw.js'))?.pushManager.getSubscription())?.endpoint ?? undefined } catch { /* 无 SW 环境 */ }
      await api.revokeOtherSessions(keep); await reload(); toast(t('已登出其它设备', 'Other devices signed out'), 'ok')
    } catch { toast(t('操作失败', 'Failed'), 'error') } finally { setBusy(null) }
  }

  return (
    <Modal onClose={onClose} label={t('登录设备', 'Devices')} panelClassName="w-full max-w-md">
        <h3 className="text-lg font-semibold">{t('登录设备', 'Devices')}</h3>
        <p className="mt-1 text-sm text-faint">{t('看到不认识的设备就登出它——会立即失去访问权限。', "Sign out any device you don't recognize — it loses access immediately.")}</p>
        <div className="mt-4 flex max-h-[50dvh] flex-col gap-2 overflow-auto">
          {sessions === null ? (
            <p className="text-sm text-faint">{t('加载中…', 'Loading…')}</p>
          ) : sessions.map((s) => (
            <div key={s.sessionId} className="flex items-center gap-3 rounded-xl surface-2 px-3 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-medium">{s.deviceLabel || t('未知设备', 'Unknown device')}</span>
                  {s.current && <span className="rounded bg-[var(--color-honey)]/15 px-1.5 py-0.5 text-[10px] font-bold text-accent">{t('本机', 'This device')}</span>}
                </div>
                <div className="text-xs text-faint">{lastSeen(s.lastSeenAt)}</div>
              </div>
              {!s.current && (
                <button onClick={() => revoke(s.sessionId)} disabled={busy === s.sessionId} className="shrink-0 text-sm font-medium text-danger hover:underline disabled:opacity-50">{t('登出', 'Sign out')}</button>
              )}
            </div>
          ))}
        </div>
        <div className="mt-5 flex gap-3">
          {sessions?.some((s) => !s.current) && (
            <Button variant="danger" className="flex-1" loading={busy === 'others'} onClick={revokeOthers}>{t('登出其它设备', 'Sign out others')}</Button>
          )}
          <Button variant="soft" className="flex-1" onClick={onClose}>{t('完成', 'Done')}</Button>
        </div>
    </Modal>
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
    <Modal onClose={onClose} label={t('两步验证', 'Two-factor authentication')} panelClassName="w-full max-w-sm">
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
    </Modal>
  )
}

/// 绑定/换绑并验证邮箱（用于账号找回；与 iOS EmailManageView 对齐）。两步：填邮箱发码 → 输码验证。
function EmailDialog({ currentEmail, verified, onClose, onChanged }: { currentEmail: string | null; verified: boolean; onClose: () => void; onChanged: () => void }) {
  const { t } = useI18n()
  const toast = useToast()
  const [email, setEmail] = useState(currentEmail ?? '')
  const [code, setCode] = useState('')
  const [stage, setStage] = useState<'enter' | 'verify'>('enter')
  const [busy, setBusy] = useState(false)

  const errText = (e: unknown): string => {
    const c = e instanceof APIError ? e.code : ''
    if (c === 'email_taken') return t('该邮箱已绑定到另一个账号', 'That email is linked to another account')
    if (c === 'mail_unavailable') return t('邮件服务暂时不可用，请稍后再试', 'Email service unavailable — try again later')
    if (c === 'invalid_input') return t('邮箱格式不正确', 'Invalid email format')
    return t('操作失败', 'Failed')
  }

  const sendCode = async () => {
    setBusy(true)
    // setEmail 成功即已在服务端换成新邮箱且置 emailVerified=false。必须 onChanged() 让父组件重拉 self——
    // 否则用户若未输码就关弹窗，安全卡仍显示**旧邮箱 + 绿色"已验证"**（找回密码等会寄到错误/未验证地址，
    // 安全误导；复审 MED）。onChanged 不卸载本弹窗，verify 流程照常。
    try { await api.setEmail(email.trim()); toast(t('验证码已发送', 'Code sent'), 'ok'); onChanged(); setStage('verify') }
    catch (e) { toast(errText(e), 'error') } finally { setBusy(false) }
  }
  const verify = async () => {
    setBusy(true)
    try { await api.verifyEmail(code.trim()); toast(t('邮箱已验证', 'Email verified'), 'ok'); onChanged(); onClose() }
    catch { toast(t('验证码无效或已过期', 'Invalid or expired code'), 'error') } finally { setBusy(false) }
  }

  return (
    <Modal onClose={onClose} label={currentEmail && verified ? t('更换邮箱', 'Change email') : t('绑定并验证邮箱', 'Verify your email')} panelClassName="w-full max-w-sm">
        <h3 className="text-lg font-semibold">{currentEmail && verified ? t('更换邮箱', 'Change email') : t('绑定并验证邮箱', 'Verify your email')}</h3>
        <p className="mt-1 text-xs text-faint">{t('用于账号找回与重要通知。我们会发一个验证码到该邮箱。', 'For account recovery and important notices. We will email you a code.')}</p>
        <div className="mt-4 flex flex-col gap-4">
          {stage === 'enter' ? (
            <Field label={t('邮箱', 'Email')}><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="you@example.com" /></Field>
          ) : (
            <Field label={t('验证码', 'Verification code')} hint={t('查收邮件中的 6 位验证码', 'Check your email for the 6-digit code')}>
              <Input inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} placeholder="000000" />
            </Field>
          )}
        </div>
        <div className="mt-5 flex gap-3">
          <Button variant="soft" className="flex-1" onClick={onClose}>{t('取消', 'Cancel')}</Button>
          {stage === 'enter'
            ? <Button className="flex-1" loading={busy} onClick={sendCode} disabled={!email.includes('@')}>{t('发送验证码', 'Send code')}</Button>
            : <Button className="flex-1" loading={busy} onClick={verify} disabled={!code.trim()}>{t('确认验证', 'Verify')}</Button>}
        </div>
        {stage === 'verify' && <button onClick={sendCode} disabled={busy} className="mt-3 w-full text-center text-xs text-faint hover:underline disabled:opacity-40">{t('重新发送验证码', 'Resend code')}</button>}
    </Modal>
  )
}

/// 用户名（唯一登录标识）+ 手机号管理。自动生成名（user_xxxx）的用户在此设置易记 userid。
function IdentityDialog({ currentUsername, currentPhone, onClose, onChanged }: { currentUsername: string; currentPhone: string | null; onClose: () => void; onChanged: () => void }) {
  const { t } = useI18n()
  const toast = useToast()
  const [username, setUsername] = useState(currentUsername)
  const [phone, setPhone] = useState(currentPhone ?? '')
  const [savingU, setSavingU] = useState(false)
  const [savingP, setSavingP] = useState(false)

  const saveUsername = async () => {
    const u = username.trim()
    if (!u || u === currentUsername) return
    setSavingU(true)
    try { await api.setUsername(u); toast(t('用户名已更新', 'Username updated'), 'ok'); onChanged() }
    catch (e) {
      const c = e instanceof APIError ? e.code : ''
      toast(c === 'username_taken' ? t('用户名已被占用', 'Username taken')
        : c === 'invalid_username' ? t('仅限字母、数字、_ . -，3–32 位', 'Letters, digits, _ . - only (3–32)')
        : contentBlockedText(e, t, t('保存失败', 'Failed')), 'error')
    } finally { setSavingU(false) }
  }
  const savePhone = async () => {
    const p = phone.trim()
    if (!p || p === (currentPhone ?? '')) return
    setSavingP(true)
    try { await api.setPhone(p); toast(t('手机号已更新', 'Phone updated'), 'ok'); onChanged() }
    catch (e) {
      const c = e instanceof APIError ? e.code : ''
      toast(c === 'phone_taken' ? t('手机号已被占用', 'Phone already in use')
        : c === 'invalid_phone' ? t('手机号格式不正确', 'Invalid phone number')
        : t('保存失败', 'Failed'), 'error')
    } finally { setSavingP(false) }
  }

  return (
    <Modal onClose={onClose} label={t('用户名 / 手机号', 'Username / phone')} panelClassName="w-full max-w-sm">
        <h3 className="text-lg font-semibold">{t('用户名 / 手机号', 'Username / phone')}</h3>
        <div className="mt-4 flex flex-col gap-4">
          <Field label={t('用户名', 'Username')} hint={t('唯一登录标识，联系人据此找到你', 'Unique sign-in ID; contacts find you by it')}>
            <div className="flex gap-2">
              <Input value={username} onChange={(e) => setUsername(e.target.value)} maxLength={32} autoCapitalize="off" autoCorrect="off" />
              <Button className="shrink-0" loading={savingU} onClick={saveUsername} disabled={!username.trim() || username.trim() === currentUsername}>{t('保存', 'Save')}</Button>
            </div>
          </Field>
          <Field label={t('手机号', 'Phone')} hint={t('可作登录标识（手机号 + 密码）', 'Can be used to sign in (phone + password)')}>
            <div className="flex gap-2">
              <Input type="tel" inputMode="tel" maxLength={20} value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+86 138…" />
              <Button className="shrink-0" loading={savingP} onClick={savePhone} disabled={!phone.trim() || phone.trim() === (currentPhone ?? '')}>{t('保存', 'Save')}</Button>
            </div>
          </Field>
        </div>
        <div className="mt-5"><Button variant="soft" className="w-full" onClick={onClose}>{t('关闭', 'Close')}</Button></div>
    </Modal>
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
    if (newPw.length < 8) { toast(t('新密码至少 8 位', 'At least 8 characters'), 'error'); return }
    setBusy(true)
    try {
      await api.setPassword(oldPw, newPw)
      toast(t('密码已修改，请重新登录', 'Password changed, please sign in again'), 'ok')
      onClose(); signOut() // 改密会吊销现有令牌
    } catch (e) {
      const msg = e instanceof APIError && e.code === 'invalid_credentials' ? t('原密码不正确', 'Wrong current password')
        : e instanceof APIError && e.code === 'password_too_common' ? t('这个密码太常见，容易被猜到——换一个更独特的', 'That password is too common — pick something more unique')
        : e instanceof APIError && e.code === 'password_too_short' ? t('新密码至少 8 位', 'At least 8 characters')
        : t('修改失败', 'Failed')
      toast(msg, 'error')
    }
    finally { setBusy(false) }
  }
  return (
    <Modal onClose={onClose} label={t('修改密码', 'Change password')} panelClassName="w-full max-w-sm">
        <h3 className="text-lg font-semibold">{t('修改密码', 'Change password')}</h3>
        <div className="mt-4 flex flex-col gap-4">
          <Field label={t('当前密码', 'Current password')}><Input type="password" value={oldPw} onChange={(e) => setOldPw(e.target.value)} autoComplete="current-password" /></Field>
          <Field label={t('新密码', 'New password')} hint={t('至少 8 位，避免常见密码', 'At least 8 characters; avoid common passwords')}><Input type="password" value={newPw} onChange={(e) => setNewPw(e.target.value)} autoComplete="new-password" /></Field>
        </div>
        <div className="mt-5 flex gap-3">
          <Button variant="soft" className="flex-1" onClick={onClose}>{t('取消', 'Cancel')}</Button>
          <Button className="flex-1" loading={busy} onClick={submit} disabled={!oldPw || !newPw}>{t('确认修改', 'Confirm')}</Button>
        </div>
    </Modal>
  )
}

/// 浏览器紧急告警通知开关（Web Push）：订阅后即使标签页关闭，摔倒/SOS 告警也会弹系统通知。
/// 服务端未配 VAPID（503）或浏览器不支持时如实显示"不可用"；权限被拒引导去浏览器设置。
function WebPushCard() {
  const { t } = useI18n()
  const toast = useToast()
  const [state, setState] = useState<'loading' | 'on' | 'off' | 'denied' | 'unsupported'>('loading')
  useEffect(() => {
    let alive = true
    void (async () => {
      if (!webPushSupported()) { if (alive) setState('unsupported'); return }
      try { await api.webVapidKey() } catch { if (alive) setState('unsupported'); return } // 服务端未配 VAPID
      if (Notification.permission === 'denied') { if (alive) setState('denied'); return }
      const subscribed = await isWebPushSubscribed()
      if (subscribed) void resyncWebPushSubscription() // 自愈：服务端行若被驱逐/回收，此刻幂等补回（防"开关开着却收不到"的假安心）
      if (alive) setState(subscribed ? 'on' : 'off')
    })()
    return () => { alive = false }
  }, [])
  const toggle = async () => {
    if (state === 'on') { await unsubscribeWebPush(); setState('off'); return }
    const r = await subscribeWebPush().catch(() => 'unsupported' as const)
    if (r === 'subscribed') { setState('on'); toast(t('已开启：关掉页面也能收到紧急告警', 'Enabled: emergency alerts arrive even with the tab closed'), 'ok') }
    else if (r === 'denied') setState('denied')
    else { setState('unsupported'); toast(t('当前不可用', 'Not available'), 'error') }
  }
  if (state === 'unsupported') return null // 不可用就不占版面（服务端未配/浏览器不支持）
  return (
    <Card className="p-5">
      <div className="mb-1 flex items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">{t('紧急告警浏览器通知', 'Emergency alerts in browser')}</div>
          <p className="mt-1 text-xs text-faint">{t('开启后，即使关闭本页面，摔倒/求救告警也会弹出系统通知。', 'When on, fall/SOS alerts show a system notification even if this page is closed.')}</p>
        </div>
        {state === 'denied' ? (
          <span className="shrink-0 text-xs text-danger">{t('通知权限被拒——请在浏览器设置里允许', 'Permission denied — allow notifications in browser settings')}</span>
        ) : (
          <button role="switch" aria-checked={state === 'on'} disabled={state === 'loading'} onClick={() => void toggle()}
            className={`relative h-7 w-12 shrink-0 rounded-full transition ${state === 'on' ? 'bg-honey' : 'bg-[var(--line)]'}`}
            aria-label={t('紧急告警浏览器通知', 'Emergency alerts in browser')}>
            <span className={`absolute top-0.5 h-6 w-6 rounded-full bg-white shadow transition-all ${state === 'on' ? 'left-[22px]' : 'left-0.5'}`} />
          </button>
        )}
      </div>
      {state === 'on' && (
        // 端到端自测：订阅存在≠推送能到（VAPID 配错/浏览器厂商侧失败只有真发一次才知道）。
        <button onClick={() => void api.webPushTest()
          .then((r) => toast(r.sent === r.total ? t('测试通知已发出，请留意系统通知', 'Test sent — check your system notifications')
                                                : t(`部分发送失败（${r.sent}/${r.total}）`, `Partially failed (${r.sent}/${r.total})`), r.sent === r.total ? 'ok' : 'error'))
          .catch(() => toast(t('发送失败', 'Failed to send'), 'error'))}
          className="mt-2 text-xs font-medium text-accent hover:underline">
          {t('发送测试通知', 'Send a test notification')}
        </button>
      )}
    </Card>
  )
}
