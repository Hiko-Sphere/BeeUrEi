import { useEffect, useState } from 'react'
import { api, type IncomingCall, type HelpRequest, type CallRecordInfo } from '../lib/api'
import { useI18n } from '../lib/i18n'
import { useCall } from './call/CallController'
import { Card, Avatar, Button, Pill, Spinner, EmptyState, timeAgo } from '../components/ui'
import { IconPhone, IconUsers, IconCheck } from '../components/icons'

export function CallsPage() {
  const { t, lang } = useI18n()
  const { answerIncoming, claimQueue, active } = useCall()
  const [incoming, setIncoming] = useState<IncomingCall[] | null>(null)
  const [queue, setQueue] = useState<HelpRequest[] | null>(null)
  const [history, setHistory] = useState<CallRecordInfo[] | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    const load = async () => {
      const [inc, q, hist] = await Promise.allSettled([api.incomingCalls(), api.helpQueue(), api.callHistory()])
      if (!alive) return
      if (inc.status === 'fulfilled') setIncoming(inc.value.calls)
      if (q.status === 'fulfilled') setQueue(q.value.requests)
      if (hist.status === 'fulfilled') setHistory(hist.value.calls)
    }
    void load()
    const id = setInterval(load, 4000)
    return () => { alive = false; clearInterval(id) }
  }, [active])

  const onAnswer = async (c: IncomingCall) => { setBusyId(c.callId); await answerIncoming(c.callId, c.fromName, c.fromAvatar); setBusyId(null) }
  const onClaim = async (r: HelpRequest) => { setBusyId(r.callId); await claimQueue(r.callId, r.fromName || r.requesterName || t('求助者', 'Requester'), undefined); setBusyId(null) }

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-2xl font-bold tracking-tight">{t('通话', 'Calls')}</h1>

      {/* 待接来电 */}
      <section>
        <SectionHead icon={<IconPhone />} title={t('待接来电', 'Incoming calls')} count={incoming?.length} />
        <Card className="overflow-hidden">
          {incoming === null ? <Spinner /> : incoming.length === 0 ? (
            <EmptyState icon={<IconPhone />} title={t('暂无来电', 'No incoming calls')} message={t('绑定的视障用户呼叫你时会出现在这里', 'Calls from linked users appear here')} />
          ) : (
            <ul className="divide-y divide-[var(--line)]">
              {incoming.map((c) => (
                <li key={c.callId} className="flex items-center gap-3 px-4 py-3">
                  <Avatar name={c.fromName} src={c.fromAvatar} size={42} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{c.fromName}</div>
                    <div className="flex items-center gap-1.5 text-xs text-ok"><span className="inline-block h-1.5 w-1.5 rounded-full bg-ok ring-live" />{t('正在呼叫…', 'Calling…')}</div>
                  </div>
                  <Button variant="ok" loading={busyId === c.callId} disabled={!!active} onClick={() => onAnswer(c)}><IconPhone width={16} height={16} />{t('接听', 'Answer')}</Button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>

      {/* 公开求助队列 */}
      <section>
        <SectionHead icon={<IconUsers />} title={t('公开求助队列', 'Open help queue')} count={queue?.length} />
        <Card className="overflow-hidden">
          {queue === null ? <Spinner /> : queue.length === 0 ? (
            <EmptyState icon={<IconUsers />} title={t('队列为空', 'Queue is empty')} message={t('有视障用户发起公开求助时会出现在这里', 'Open requests from blind users appear here')} />
          ) : (
            <ul className="divide-y divide-[var(--line)]">
              {queue.map((r) => (
                <li key={r.callId} className="flex items-center gap-3 px-4 py-3">
                  <Avatar name={r.fromName || r.requesterName || '?'} size={42} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{r.fromName || r.requesterName || t('求助者', 'Requester')}</div>
                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-faint">
                      {r.lang && <Pill>{r.lang.toUpperCase()}</Pill>}
                      {r.createdAt && <span>{timeAgo(r.createdAt, lang)}</span>}
                    </div>
                  </div>
                  <Button loading={busyId === r.callId} disabled={!!active} onClick={() => onClaim(r)}><IconCheck width={16} height={16} />{t('认领接入', 'Claim')}</Button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>

      {/* 通话记录 */}
      <section>
        <SectionHead icon={<IconPhone />} title={t('通话记录', 'Call history')} />
        <Card className="overflow-hidden">
          {history === null ? <Spinner /> : history.length === 0 ? (
            <EmptyState icon={<IconPhone />} title={t('暂无记录', 'No history')} />
          ) : (
            <ul className="divide-y divide-[var(--line)]">
              {history.map((c) => (
                <li key={c.id} className="flex items-center gap-3 px-4 py-3">
                  <Avatar name={c.peerName || '?'} src={c.peerAvatar} size={36} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium">{c.peerName}</div>
                    <div className="text-xs text-faint">{c.direction === 'outgoing' ? t('呼出', 'Outgoing') : t('呼入', 'Incoming')} · {timeAgo(c.createdAt, lang)}</div>
                  </div>
                  <Pill tone={c.status === 'answered' ? 'ok' : c.status === 'declined' ? 'danger' : 'soft'}>
                    {c.status === 'answered' ? t('已接通', 'Answered') : c.status === 'declined' ? t('已拒绝', 'Declined') : t('未接', 'Missed')}
                  </Pill>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>
    </div>
  )
}

function SectionHead({ icon, title, count }: { icon: React.ReactNode; title: string; count?: number }) {
  return (
    <div className="mb-2 flex items-center gap-2 px-1">
      <span className="text-honey">{icon}</span>
      <h2 className="text-sm font-semibold">{title}</h2>
      {count !== undefined && count > 0 && <Pill tone="honey">{count}</Pill>}
    </div>
  )
}
