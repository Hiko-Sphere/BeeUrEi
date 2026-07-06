import { Link } from 'react-router-dom'
import { type CallRecordInfo } from '../lib/api'
import { useI18n } from '../lib/i18n'
import { Avatar, Pill, timeAgo } from './ui'

/// 通话记录行（首页/通话页共用，防两处漂移）：对端仍在则整行链到与其的聊天（跟进/回访求助者，
/// 同手机最近通话点一下进对话）；已注销(peerId 为 null)则渲染成不可点的普通行，无死链。
/// className 传各处自有的行内边距（首页 px-5 对齐其 px-5 卡头；通话页 px-4）。
export function CallHistoryRow({ call: c, className = 'px-4 py-3' }: { call: CallRecordInfo; className?: string }) {
  const { t, lang } = useI18n()
  const inner = `flex items-center gap-3 ${className}`
  const row = (
    <>
      <Avatar name={c.peerName || '?'} src={c.peerAvatar} size={36} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium">{c.peerName}</span>
          {/* 紧急求助呼叫（盲人一键 SOS）：通话记录里突出——尤其"未接紧急求助"须让协助者一眼看到、优先回拨。读屏可闻。 */}
          {c.emergency && <span className="shrink-0 rounded-full bg-danger/15 px-1.5 py-0.5 text-[10px] font-bold text-danger">{t('🆘 紧急求助', '🆘 SOS')}</span>}
        </div>
        <div className="text-xs text-faint">{c.direction === 'outgoing' ? t('呼出', 'Outgoing') : t('呼入', 'Incoming')} · {timeAgo(c.createdAt, lang)}</div>
      </div>
      <Pill tone={c.status === 'answered' ? 'ok' : c.status === 'declined' ? 'danger' : 'soft'}>
        {c.status === 'answered' ? t('已接通', 'Answered') : c.status === 'declined' ? t('已拒绝', 'Declined') : t('未接', 'Missed')}
      </Pill>
    </>
  )
  return (
    <li>
      {c.peerId
        ? <Link to={`/chat/${c.peerId}`} className={`${inner} transition hover:surface-2`} aria-label={t(`与 ${c.peerName} 的聊天`, `Chat with ${c.peerName}`)}>{row}</Link>
        : <div className={inner}>{row}</div>}
    </li>
  )
}
