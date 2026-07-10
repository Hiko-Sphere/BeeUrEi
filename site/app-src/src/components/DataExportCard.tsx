import { useState } from 'react'
import { fetchAccountExportBlob, APIError } from '../lib/api'
import { useI18n } from '../lib/i18n'
import { Card, Button, useToast } from './ui'

/// 数据导出卡（Account 页）：GDPR 数据可携权——一键下载本人全量数据 JSON。此前服务端有 /api/account/export
/// 端点，web 却无入口（死端点）。含安全提示：导出会预警本人（被盗会话无法静默外带）。限流 3/时。
export function DataExportCard() {
  const { t } = useI18n()
  const toast = useToast()
  const [busy, setBusy] = useState(false)

  const download = async () => {
    setBusy(true)
    try {
      const blob = await fetchAccountExportBlob()
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = 'beeurei-my-data.json'
      document.body.appendChild(a); a.click(); a.remove()
      URL.revokeObjectURL(url)
      toast(t('已开始下载你的数据', 'Your data download has started'), 'ok')
    } catch (e) {
      toast(e instanceof APIError && e.status === 429
        ? t('导出太频繁，请稍后再试（每小时最多 3 次）', 'Too many exports — try again later (max 3/hour)')
        : t('导出失败，请稍后再试', 'Export failed — try again later'), 'error')
    } finally { setBusy(false) }
  }

  return (
    <Card className="p-4">
      <div className="text-sm font-semibold">{t('导出我的数据', 'Export my data')}</div>
      <p className="mt-1 text-sm text-faint">{t('下载你在本应用的全部数据（个人资料、联系人、你发出的消息、通话记录、安全报到、紧急事件等）为 JSON 文件。他人发给你的消息、拉黑你的人不含在内（那是他人的数据）；媒体仅含元数据；密码与令牌绝不导出。',
        'Download all your data (profile, contacts, messages you sent, call history, check-ins, emergencies, and more) as a JSON file. Messages others sent you and people who blocked you are not included (that is their data); media is metadata only; passwords and tokens are never exported.')}</p>
      <p className="mt-1 text-xs text-faint">{t('为你的安全，每次导出都会通知你本人（被盗会话无法静默带走你的数据）。',
        'For your safety, every export alerts you (a stolen session can’t silently take your data).')}</p>
      <Button variant="soft" onClick={download} disabled={busy} className="mt-3">{t('下载我的数据', 'Download my data')}</Button>
    </Card>
  )
}
