import { useEffect, useState } from 'react'
import { webPushSupported, isWebPushSubscribed, subscribeWebPush } from '../lib/webPush'
import { useI18n } from '../lib/i18n'
import { useToast } from './ui'

/// 「你是紧急联系人但浏览器通知没开」真实检查（自我版的假安心防护）：作为 N 个人的紧急联系人，若本浏览器
/// 未订阅 web-push，关标签页时就收不到 TA 的摔倒/SOS 告警——而本人往往不自知（设置里的开关埋得深）。此处
/// 主动核实并一键开启。仅在「我是紧急联系人 ∧ 浏览器支持 ∧ 未订阅」时警告；已开/不支持/非紧急联系人不渲染。
export function EmergencyContactPushWarning({ emergencyFor }: { emergencyFor: number }) {
  const { t } = useI18n()
  const toast = useToast()
  const [status, setStatus] = useState<'unknown' | 'on' | 'off' | 'unsupported'>('unknown')
  const [busy, setBusy] = useState(false)

  useEffect(() => { void (async () => {
    if (!webPushSupported()) { setStatus('unsupported'); return }
    try { setStatus((await isWebPushSubscribed()) ? 'on' : 'off') } catch { setStatus('unknown') }
  })() }, [])

  const enable = async () => {
    setBusy(true)
    try {
      const r = await subscribeWebPush()
      if (r === 'subscribed') { setStatus('on'); toast(t('浏览器通知已开启，现在能收到紧急告警了', 'Browser notifications on — you can now receive emergency alerts'), 'ok') }
      else toast(r === 'denied'
        ? t('你在浏览器里拒绝了通知，请在浏览器地址栏的站点权限里手动允许', 'You denied notifications in the browser — allow them in the site permissions')
        : t('此浏览器不支持通知，或服务端未配置', 'This browser does not support notifications, or the server is not configured'), 'error')
    } catch { toast(t('开启失败，请重试', 'Failed — try again'), 'error') }
    finally { setBusy(false) }
  }

  // 只在真有风险时才警告：我是紧急联系人、浏览器支持推送、但当前未订阅。
  if (emergencyFor === 0 || status !== 'off') return null
  return (
    <div role="alert" className="flex flex-wrap items-center gap-2 rounded-xl border border-danger/50 bg-danger/5 px-3 py-2.5 text-sm text-danger">
      <span aria-hidden>⚠️</span>
      <span className="min-w-0 flex-1">{t(`你是 ${emergencyFor} 位联系人的紧急联系人，但此浏览器未开启通知——关闭标签页时可能收不到 TA 的告警。`,
        `You're the emergency contact for ${emergencyFor} ${emergencyFor > 1 ? 'people' : 'person'}, but browser notifications are off — you may miss their alerts when this tab is closed.`)}</span>
      <button onClick={() => void enable()} disabled={busy}
        className="shrink-0 rounded-lg bg-danger px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-50">
        {t('开启通知', 'Enable notifications')}
      </button>
    </div>
  )
}
