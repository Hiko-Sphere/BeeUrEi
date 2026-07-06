import { useState } from 'react'
import { api } from '../lib/api'
import { useI18n } from '../lib/i18n'
import { useToast, Button, Modal } from './ui'
import { IconUser } from './icons'

/// 举报与安全弹层（信任与安全）。可从**通话**（带 callId + 可附录制为证据 + 加好友/拉黑）或
/// **联系人/聊天**（仅 targetUserId + 理由）发起——服务端 /api/reports 的 callId/evidenceRecordingId 均可选，
/// 故被骚扰不必非得在通话中才能举报。call 专属 UI（附录制开关、加好友/拉黑按钮）按传入的 props 有无条件渲染。
export function ReportDialog({ targetUserId, callId, evidenceRecordingId, onClose, onAddFriend, onBlock }: {
  targetUserId: string
  callId?: string
  evidenceRecordingId?: string | null
  onClose: () => void
  onAddFriend?: () => void
  onBlock?: () => void
}) {
  const { t } = useI18n()
  const toast = useToast()
  const [reason, setReason] = useState('')
  const [attach, setAttach] = useState(false)
  const [busy, setBusy] = useState(false)
  const submit = async () => {
    if (!reason.trim()) return
    setBusy(true)
    try {
      await api.report(targetUserId, reason.trim(), callId, attach && evidenceRecordingId ? evidenceRecordingId : undefined)
      toast(t('举报已提交', 'Report submitted'), 'ok')
      onClose()
    } catch { toast(t('提交失败', 'Failed to submit'), 'error') } finally { setBusy(false) }
  }
  return (
    <Modal onClose={onClose} label={t('举报与安全', 'Report & Safety')} panelClassName="w-full max-w-sm">
      <h3 className="text-lg font-semibold">{t('举报与安全', 'Report & Safety')}</h3>
      <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={1000}
        placeholder={t('请描述问题（必填）', 'Describe the issue (required)')}
        className="mt-3 w-full resize-none rounded-xl border border-[var(--line)] surface-2 px-3 py-2.5 text-sm outline-none focus:border-honey" />
      {evidenceRecordingId && (
        <label className="mt-3 flex items-center gap-2 text-sm text-soft">
          <input type="checkbox" checked={attach} onChange={(e) => setAttach(e.target.checked)} className="accent-[var(--color-honey)]" />
          {t('附上本次通话录制作为证据', 'Attach this call recording as evidence')}
        </label>
      )}
      <Button variant="danger" className="mt-4 w-full" loading={busy} onClick={submit} disabled={!reason.trim()}>{t('提交举报', 'Submit report')}</Button>
      {(onAddFriend || onBlock) && (
        <div className="mt-3 flex gap-2">
          {onAddFriend && <Button variant="soft" className="flex-1" onClick={onAddFriend}><IconUser width={16} height={16} />{t('加为联系人', 'Add contact')}</Button>}
          {onBlock && <Button variant="ghost" className="flex-1" onClick={onBlock}>{t('拉黑', 'Block')}</Button>}
        </div>
      )}
      <button onClick={onClose} className="mt-3 w-full text-center text-sm text-faint hover:underline">{t('取消', 'Cancel')}</button>
    </Modal>
  )
}
