import { useEffect, useState } from 'react'
import { api, type EmergencyReadiness } from '../lib/api'
import { useI18n } from '../lib/i18n'
import { Card, Button, useToast } from './ui'

/// 应急就绪自检卡（Family 页）：出事**之前**先确认紧急联系人能否即时收到告警——防"安全网其实是空的/
/// 联系人没装 App 或没开通知"的假安心（这正是本项目核心安全价值）。三态：无紧急联系人(danger) /
/// 部分或全部不可达(danger，逐个点出谁不可达) / 全部可达(ok)。加载失败静默不渲染（不制造假警报）。
export function EmergencyReadinessCard({ refreshKey }: { refreshKey?: unknown }) {
  const { t } = useI18n()
  const toast = useToast()
  const [r, setR] = useState<EmergencyReadiness | null>(null)
  const [testing, setTesting] = useState(false)
  // 发测试告警：真正给联系人发一条**标注为测试**的通知，验证告警链路确实送达（就绪自检只查"有推送通道"）。
  // confirm 防误发骚扰联系人；成功后按实际触达数给回执。
  const sendTest = async () => {
    if (!confirm(t('将给你的联系人发送一条「测试告警」通知，用于确认告警能送达。确定发送？',
      'This sends your contacts a clearly-labeled TEST alert to confirm alerts reach them. Send it?'))) return
    setTesting(true)
    try {
      const res = await api.sendTestAlert()
      toast(res.notified >= res.contacts && res.contacts > 0
        ? t(`测试告警已发出，${res.contacts} 位联系人都能即时收到。`, `Test sent — all ${res.contacts} contacts can receive it instantly.`)
        : t(`测试告警已发给 ${res.contacts} 位联系人，其中 ${res.notified} 位有即时推送通道。`, `Test sent to ${res.contacts} contacts; ${res.notified} have an instant push channel.`),
        res.notified >= res.contacts ? 'ok' : 'info')
    } catch { toast(t('发送失败，请稍后再试', 'Failed — try again later'), 'error') }
    finally { setTesting(false) }
  }
  // 加载失败保持 r=null → 不渲染，绝不显示可能过时/错误的就绪状态（假安心防护）。
  // refreshKey 变化时重拉（父页在增删联系人/设/撤紧急联系人后传新值）——否则刚设了紧急联系人、
  // 就绪状态却仍显示旧的"无紧急联系人"，是安全信息陈旧的假安心/假警报。
  useEffect(() => { void api.emergencyReadiness().then(setR).catch(() => { /* 保持未加载态，不渲染 */ }) }, [refreshKey])
  if (!r) return null

  const allReachable = r.hasEmergencyContact && r.reachable === r.total
  const border = allReachable ? 'border-ok/40' : 'border-danger/50'
  return (
    <Card className={`border ${border} p-4`}>
      <div role="status" className="flex items-start gap-3">
        <span aria-hidden className={`mt-0.5 text-lg ${allReachable ? 'text-ok' : 'text-danger'}`}>{allReachable ? '✓' : '⚠️'}</span>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">{t('应急就绪', 'Emergency readiness')}</div>
          {!r.hasEmergencyContact ? (
            // 最危险：一个紧急联系人都没有——出事时告警无人可收。
            <p className="mt-0.5 text-sm text-danger">{t('你还没有设置紧急联系人——出事时不会有人收到告警。请在下方把某位联系人设为紧急联系人。',
              'You have no emergency contact — no one will be alerted in an emergency. Set one as an emergency contact below.')}</p>
          ) : allReachable ? (
            <p className="mt-0.5 text-sm text-soft">{t(`你的 ${r.total} 位紧急联系人都能即时收到告警。`, `All ${r.total} of your emergency contacts can receive instant alerts.`)}</p>
          ) : (
            <>
              <p className="mt-0.5 text-sm text-danger">{t(`${r.total} 位紧急联系人中只有 ${r.reachable} 位能即时收到告警。不可达的联系人需在其设备上安装 App 并开启通知。`,
                `Only ${r.reachable} of ${r.total} emergency contacts can receive instant alerts. Unreachable contacts need to install the app and enable notifications on their device.`)}</p>
              <ul className="mt-2 space-y-1">
                {r.contacts.filter((c) => !c.reachable).map((c, i) => (
                  <li key={i} className="flex items-center gap-2 text-xs text-faint">
                    <span aria-hidden className="text-danger">●</span>
                    <span className="truncate">{c.name}{c.relation ? ` · ${c.relation}` : ''}</span>
                    <span className="text-danger">{t('收不到即时告警', 'Can’t receive instant alerts')}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
          {/* 有联系人才给「发测试告警」——真正验证送达（不只理论可达）。无联系人时先去设置，无从测起。 */}
          {r.hasEmergencyContact && (
            <Button variant="soft" onClick={sendTest} disabled={testing} className="mt-3">
              {t('发送测试告警', 'Send test alert')}
            </Button>
          )}
        </div>
      </div>
    </Card>
  )
}
