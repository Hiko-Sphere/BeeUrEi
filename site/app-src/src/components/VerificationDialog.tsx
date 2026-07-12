import { useState } from 'react'
import { api, APIError, reencodeToJpeg, uploadVerificationDoc, type VerificationStatusInfo } from '../lib/api'
import { useI18n } from '../lib/i18n'
import { Button, Field, Input, Modal, useToast } from './ui'

// 实名认证（KYC）配置与文案。此前内联在 Account.tsx——抽到独立文件后 Account 可懒加载出主包
// （eager 的 VerificationGate 只需本组件，不必拖上整张 900 行的 Account）。
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
    let createdId: string | null = null // 记录已建的待审 id，供文档上传失败时回滚
    try {
      const { id } = await api.submitVerification({ legalName: legalName.trim(), idType, idNumberLast4: idLast4, consentVersion: KYC_CONSENT_VERSION })
      createdId = id
      const front = await reencodeToJpeg(frontFile)
      const selfie = await reencodeToJpeg(selfieFile)
      await uploadVerificationDoc(id, 'front', front)
      await uploadVerificationDoc(id, 'selfie', selfie)
      createdId = null // 证件已传全，无需回滚
      toast(t('已提交，等待人工审核', 'Submitted — pending review'), 'ok')
      await onChanged()
      onClose()
    } catch (e) {
      // 记录已建但证件没传全（reencode/上传中途失败）→ 自动回滚该 pending，让用户能**立即重试**，
      // 而非被 already_pending 卡死、也不给审核员留一份缺图的申请（回滚失败还有"撤回申请"按钮兜底）。
      if (createdId) { try { await api.withdrawVerification() } catch { /* 回滚也失败：留给状态页「撤回申请」按钮 */ } }
      const code = e instanceof APIError ? e.code : ''
      setErr(code === 'already_pending' ? t('已有一份待审核的申请', 'You already have a pending submission')
        : code === 'already_verified' ? t('你已通过实名认证', 'You are already verified')
        : code === 'image_decode_failed' ? t('图片无法读取，请换一张', 'Could not read the image — try another')
        : t('提交失败，请重试', 'Submission failed — please try again'))
    } finally { setBusy(false) }
  }

  // 撤回待审申请：让用户从「卡住的/照片不佳的」pending 中脱身重交（此前 UI 无入口，only already_pending 拦着
  // 无从恢复——尤其提交时文档上传半途失败会留下不完整的 pending）。服务端 DELETE 会清掉证件密文与 blob。
  const withdraw = async () => {
    if (!confirm(t('撤回后当前审核申请将作废，可重新提交。确定撤回？', 'Withdrawing cancels the current review; you can resubmit afterward. Withdraw?'))) return
    setErr(null); setBusy(true)
    try { await api.withdrawVerification(); toast(t('已撤回，可重新提交', 'Withdrawn — you can resubmit'), 'ok'); await onChanged() }
    catch { setErr(t('撤回失败，请重试', 'Withdrawal failed — please try again')) }
    finally { setBusy(false) }
  }

  return (
    <Modal onClose={onClose} label={t('实名认证', 'Identity verification')} panelClassName="max-h-[88dvh] w-full max-w-md overflow-auto">
        <h3 className="text-lg font-semibold">{t('实名认证', 'Identity verification')}</h3>

        {step === 'status' && (
          <div className="mt-3 flex flex-col gap-3">
            {st === 'verified' && <p className="rounded-xl bg-honey/10 p-3 text-sm text-accent">✓ {t('你已通过实名认证，账号已显示「已认证」徽章。', 'You are verified — the verified badge appears on your account.')}</p>}
            {st === 'pending' && <p className="rounded-xl surface-2 p-3 text-sm text-soft">{t('审核中，通常 1–2 个工作日。结果会通过通知告知你。', 'Under review, usually 1–2 business days. We will notify you of the result.')}</p>}
            {st === 'rejected' && (
              <div className="rounded-xl border border-danger/30 p-3 text-sm text-soft">
                {t('上次未通过：', 'Last attempt was not approved: ')}
                {(REJECT_REASONS[status?.rejectReasonCode ?? 'other'] ?? REJECT_REASONS.other)[lang === 'en' ? 1 : 0]}
                {/* 管理员的具体说明（死字段修复）：服务端仅在被拒时把 rejectReasonNote 下发给本人、web 类型也解了它，
                    却从未呈现——用户只见标准理由、不知**具体**哪里不对，只能盲目重交。展示便于对症修正。React 默认转义无 XSS。 */}
                {status?.rejectReasonNote && status.rejectReasonNote.trim() && (
                  <span className="mt-1.5 block text-faint">{t('审核说明：', 'Reviewer note: ')}{status.rejectReasonNote}</span>
                )}
              </div>
            )}
            {st === 'none' && <p className="text-sm text-faint">{t('通过实名认证可获得「已认证」徽章，让联系人更信任你。', 'Verify your identity to earn a trusted badge your contacts can see.')}</p>}
            {err && <p className="text-sm text-danger">{err}</p>}
            <div className="mt-2 flex gap-3">
              {canStart && <Button className="flex-1" onClick={() => setStep('consent')}>{st === 'rejected' ? t('重新提交', 'Resubmit') : t('开始认证', 'Start')}</Button>}
              {st === 'pending' && <Button variant="soft" className="flex-1" loading={busy} onClick={withdraw} data-testid="withdraw-verif">{t('撤回申请', 'Withdraw')}</Button>}
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
