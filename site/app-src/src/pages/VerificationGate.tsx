import { useEffect, useState } from 'react'
import { api, type VerificationStatusInfo } from '../lib/api'
import { useSession } from '../lib/session'
import { useI18n } from '../lib/i18n'
import { Card, Button } from '../components/ui'
import { VerificationDialog } from '../components/VerificationDialog'

/// 实名认证门禁屏（协助/亲友网页端）：管理员开启「要求实名认证」且当前用户未通过 KYC 时，
/// 取代正常应用——仅允许提交/查询实名认证与退出登录。审核通过后刷新即解除。
export function VerificationGate() {
  const { user, refreshMe, signOut } = useSession()
  const { t, lang } = useI18n()
  const [status, setStatus] = useState<VerificationStatusInfo | null>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  const reload = async () => { try { setStatus(await api.verificationStatus()) } catch { /* ignore */ } }
  useEffect(() => { void reload() }, [])

  const st = status?.status ?? 'none'
  const reject = (REJECT[status?.rejectReasonCode ?? 'other'] ?? REJECT.other)[lang === 'en' ? 1 : 0]

  const refresh = async () => { setBusy(true); try { await reload(); await refreshMe() } finally { setBusy(false) } }

  return (
    <div className="grid min-h-dvh place-items-center p-4">
      <Card className="w-full max-w-md p-6 text-center">
        <div className="mx-auto mb-3 grid size-14 place-items-center rounded-2xl bg-honey/15 text-2xl text-honey">🪪</div>
        <h1 className="text-xl font-bold">{t('需要先完成实名认证', 'Identity verification required')}</h1>
        <p className="mt-2 text-sm text-faint">
          {t('为保障安全与可信，使用本应用需先通过实名认证（人工审核，通常 1–2 个工作日）。',
            'For safety and trust, you must pass identity verification before using the app (reviewed by a person, usually 1–2 business days).')}
        </p>

        {st === 'pending' && (
          <p className="mt-4 rounded-xl surface-2 p-3 text-sm text-soft">
            {t('审核中，通常 1–2 个工作日。通过后刷新即可进入。', 'Under review, usually 1–2 business days. Refresh once approved.')}
          </p>
        )}
        {st === 'rejected' && (
          <p className="mt-4 rounded-xl border border-danger/30 p-3 text-sm text-soft">{t('上次未通过：', 'Last attempt was not approved: ') + reject}</p>
        )}

        <div className="mt-5 flex flex-col gap-2">
          <Button onClick={() => setOpen(true)}>
            {st === 'rejected' ? t('重新提交', 'Resubmit') : st === 'pending' ? t('查看认证状态', 'View status') : t('开始实名认证', 'Start verification')}
          </Button>
          <Button variant="soft" loading={busy} onClick={refresh}>{t('我已通过，刷新', "I've been approved — refresh")}</Button>
          <Button variant="soft" onClick={() => { if (confirm(t('确定退出登录？', 'Sign out?'))) signOut() }}>{t('退出登录', 'Sign out')}</Button>
        </div>
        {user && <p className="mt-4 text-xs text-faint">@{user.username}</p>}
      </Card>

      {open && <VerificationDialog status={status} onClose={() => setOpen(false)} onChanged={async () => { await reload(); await refreshMe() }} />}
    </div>
  )
}

const REJECT: Record<string, [string, string]> = {
  blurry: ['证件照片不够清晰，请重拍。', 'The photo was too blurry — retake it.'],
  glare: ['证件照片有反光，请重拍。', 'The photo had glare — retake it.'],
  name_mismatch: ['姓名与证件不一致，请核对后重新提交。', 'Name did not match — check and resubmit.'],
  face_mismatch: ['自拍与证件不匹配，请重新拍摄。', 'Selfie did not match — retake it.'],
  expired: ['证件已过期，请使用有效证件。', 'The document has expired.'],
  unsupported_doc: ['证件类型不被支持。', 'Document type not supported.'],
  incomplete: ['资料不完整，请补齐。', 'Submission incomplete.'],
  suspected_fraud: ['审核未通过。', 'Verification was not approved.'],
  timeout: ['超过审核时限已关闭，请重新提交。', 'Timed out — please resubmit.'],
  revoked: ['实名认证已被撤销。', 'Verification was revoked.'],
  other: ['审核未通过，请重新提交。', 'Not approved — please resubmit.'],
}
