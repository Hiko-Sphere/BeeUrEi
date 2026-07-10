import { Link } from 'react-router-dom'
import { type CallRecordInfo } from '../lib/api'
import { useI18n } from '../lib/i18n'
import { Avatar, Pill, timeAgo, fmtDuration } from './ui'
import { IconPhone } from './icons'

/// 通话记录行（首页/通话页共用，防两处漂移）：对端仍在则姓名区链到与其的聊天（跟进/回访求助者）；
/// 已注销(peerId 为 null)则渲染成不可点的普通行，无死链。父组件传 onCall 时额外显示"呼叫"按钮——
/// 尤其**未接的紧急求助**(assist/call emergency)只出现在通话记录、不进通知列表，此前只能点进聊天绕一圈才能回拨。
/// className 传各处自有的行内边距（首页 px-5 对齐其 px-5 卡头；通话页 px-4）。
export function CallHistoryRow({ call: c, className = 'px-4 py-3', onCall, callDisabled }: {
  call: CallRecordInfo
  className?: string
  onCall?: (c: CallRecordInfo) => void // 提供则显示"呼叫"按钮（一键回拨对端）；父组件用 useCall.startOutgoing 接线
  callDisabled?: boolean               // 通话进行中禁用（不能同时发起第二通）
}) {
  const { t, lang } = useI18n()
  // 已注销对端(peerId 为 null)：服务端 peerName 回落成硬编码中文「已注销用户」，会漏给英文用户。
  // 客户端据 peerId===null 本地化，杜绝语言泄漏（服务端硬编码另有 chip 系统性收口）。peerId 在则为真实姓名。
  const peerName = c.peerId ? c.peerName : t('已注销用户', 'Deactivated user')
  const content = (
    <>
      <Avatar name={peerName || '?'} src={c.peerAvatar} size={36} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium">{peerName}</span>
          {/* 紧急求助呼叫（盲人一键 SOS）：通话记录里突出——尤其"未接紧急求助"须让协助者一眼看到、优先回拨。读屏可闻。 */}
          {c.emergency && <span className="shrink-0 rounded-full bg-danger/15 px-1.5 py-0.5 text-[10px] font-bold text-danger">{t('🆘 紧急求助', '🆘 SOS')}</span>}
        </div>
        <div className="text-xs text-faint">
          {c.direction === 'outgoing' ? t('呼出', 'Outgoing') : t('呼入', 'Incoming')} · {timeAgo(c.createdAt, lang)}
          {/* 通话时长（接通并上报后才有）：与手机通话记录一致显示"3:24"。 */}
          {typeof c.durationSec === 'number' && c.durationSec > 0 && <> · {fmtDuration(c.durationSec)}</>}
        </div>
      </div>
      <Pill tone={c.status === 'answered' ? 'ok' : c.status === 'declined' ? 'danger' : 'soft'}>
        {c.status === 'answered' ? t('已接通', 'Answered') : c.status === 'declined' ? t('已拒绝', 'Declined') : t('未接', 'Missed')}
      </Pill>
    </>
  )
  return (
    <li className={`flex items-center ${className}`}>
      {c.peerId
        ? <Link to={`/chat/${c.peerId}`} className="flex min-w-0 flex-1 items-center gap-3 rounded-lg transition hover:surface-2" aria-label={t(`与 ${c.peerName} 的聊天`, `Chat with ${c.peerName}`)}>{content}</Link>
        : <div className="flex min-w-0 flex-1 items-center gap-3">{content}</div>}
      {/* 一键呼叫对端（回拨）：对端仍在(peerId)且父组件接了 onCall 才显示；通话中禁用（不能同时两通）。
          按钮是 Link 的**兄弟**节点、不嵌套（避免 nested-interactive a11y 违规，同通知页回拨/删除的排布）。 */}
      {c.peerId && onCall && (
        <button onClick={() => onCall(c)} disabled={callDisabled}
          className="ml-2 shrink-0 inline-flex items-center gap-1 rounded-lg px-2.5 py-1.5 text-xs font-medium text-ok hover:surface-2 disabled:cursor-not-allowed disabled:opacity-40"
          aria-label={t(`呼叫 ${c.peerName}`, `Call ${c.peerName}`)}>
          <IconPhone width={14} height={14} />{t('呼叫', 'Call')}
        </button>
      )}
    </li>
  )
}
