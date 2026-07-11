import { useEffect, useState } from 'react'
import { api, APIError } from '../lib/api'
import { useI18n } from '../lib/i18n'
import { timeAgo } from './ui'

/// 施救医疗信息（点击拉取遇险者的紧急医疗信息——服务端仅授权其 accepted 紧急联系人）。独立组件（原在
/// EmergencyAlertHost 内、耦合了 useCall/webrtc）：抽出便于告警弹窗/通知列表/活跃紧急看板三处复用且轻量可测。
export function ContactMedicalInfo({ userId, emphasize }: { userId: string; emphasize?: boolean }) {
  const { t, lang } = useI18n()
  const [state, setState] = useState<{ kind: 'idle' | 'loading' | 'ok' | 'none' | 'denied' | 'error'; text?: string; updatedAt?: number | null }>({ kind: 'idle' })
  // 换人即复位：本组件按 userId 拉取医疗信息，userId 变了(如告警模态从第一位遇险者切到第二位)必须清掉上一人的
  // 已加载态，否则会**静默显示上一人的医疗信息(过敏/用药/血型)**——急救时据错人数据行动极危险（见对抗复审）。
  // 调用点另加 key={userId} 令 React 直接重挂载(无残帧)；此复位是覆盖所有复用点的组件自身保障（双保险）。
  useEffect(() => { setState({ kind: 'idle' }) }, [userId])
  const load = async () => {
    setState({ kind: 'loading' })
    try {
      const { medicalInfo, updatedAt } = await api.contactMedicalInfo(userId)
      setState({ kind: 'ok', text: medicalInfo, updatedAt })
    } catch (e) {
      const s = e instanceof APIError ? e.status : 0
      setState({ kind: s === 404 ? 'none' : s === 403 ? 'denied' : 'error' })
    }
  }
  if (state.kind === 'idle') {
    // emphasize（告警带 hasMedical=1，即发起人确有医疗信息）：显式提示 + 醒目按钮，避免施救者忽略关键信息。
    return emphasize ? (
      <button onClick={load} data-testid="view-medical-btn"
        className="inline-flex items-center gap-1.5 self-start rounded-lg border border-danger/50 bg-danger/5 px-3 py-2 text-sm font-semibold text-danger hover:bg-danger/10">
        🩺 {t('此人有紧急医疗信息，点击查看', 'They have emergency medical info — tap to view')}
      </button>
    ) : (
      <button onClick={load} data-testid="view-medical-btn"
        className="inline-flex items-center gap-1.5 self-start rounded-lg border border-[var(--line)] px-3 py-1.5 text-sm font-medium hover:surface-2">
        🩺 {t('查看紧急医疗信息', 'View emergency medical info')}
      </button>
    )
  }
  if (state.kind === 'loading') return <p className="text-sm text-faint">{t('加载中…', 'Loading…')}</p>
  if (state.kind === 'ok') return (
    <div data-testid="medical-info-content" className="rounded-xl border border-honey/40 bg-honey/5 p-3">
      <div className="mb-1 text-xs font-semibold text-soft">🩺 {t('紧急医疗信息', 'Emergency medical info')}</div>
      <p className="whitespace-pre-wrap break-words text-sm">{state.text}</p>
      {/* 更新时间（施救参考）：服务端一直下发 updatedAt。医疗信息会随用药/病史变化——施救者需据"多久前更新"
          判断是否可能过时（几天前=可信；数年前=谨慎核对）。相对时间对"是否当前"更直观。 */}
      {state.updatedAt != null && (
        <div className="mt-1.5 text-xs text-faint">{t('更新于 ', 'Updated ')}{timeAgo(state.updatedAt, lang)}</div>
      )}
    </div>
  )
  const msg = state.kind === 'none' ? t('对方未填写医疗信息', 'No medical info provided')
    : state.kind === 'denied' ? t('仅遇险者的紧急联系人可查看', 'Only their emergency contacts can view this')
    : t('加载失败', 'Failed to load')
  return <p className="text-sm text-faint" data-testid="medical-info-msg">{msg}</p>
}
