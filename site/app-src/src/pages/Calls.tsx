import { useEffect, useState } from 'react'
import { api, type IncomingCall, type HelpRequest, type CallRecordInfo } from '../lib/api'
import { pollWhileVisible } from '../lib/poll'
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
      // 每段独立：成功则更新；失败时——若已有数据则保留(轮询瞬时失败不清屏)，若仍是初始 null 则落为空数组，
      // 退出加载态(否则某个端点持续失败会让该段永远转圈；页面每 4s 轮询，恢复后自然填回)。
      if (inc.status === 'fulfilled') setIncoming(inc.value.calls); else setIncoming((c) => c ?? [])
      if (q.status === 'fulfilled') setQueue(q.value.requests); else setQueue((c) => c ?? [])
      if (hist.status === 'fulfilled') setHistory(hist.value.calls); else setHistory((c) => c ?? [])
    }
    void load()
    const stop = pollWhileVisible(load, 4000)
    return () => { alive = false; stop() }
  }, [active])

  const onAnswer = async (c: IncomingCall) => { setBusyId(c.callId); await answerIncoming(c.callId, c.fromName, c.fromAvatar); setBusyId(null) }
  const onClaim = async (r: HelpRequest) => { setBusyId(r.callId); await claimQueue(r.callId, r.fromName || t('求助者', 'Requester'), undefined); setBusyId(null) }
  // 等待时长（后端给的是 waitedSeconds，非时间戳）：>60s 显示分钟，否则秒。
  const waited = (s: number) => s >= 60 ? t(`已等待 ${Math.floor(s / 60)} 分钟`, `waited ${Math.floor(s / 60)}m`) : t(`已等待 ${s} 秒`, `waited ${s}s`)

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
                  <Button variant="ok" loading={busyId === c.callId} disabled={!!active} onClick={() => onAnswer(c)}
                    aria-label={t(`接听 ${c.fromName} 的来电`, `Answer call from ${c.fromName}`)}><IconPhone width={16} height={16} />{t('接听', 'Answer')}</Button>
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
                  <Avatar name={r.fromName} src={r.fromAvatar} size={42} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{r.fromName}</div>
                    {r.topic && <div className="truncate text-sm text-soft">{r.topic}</div>}
                    <div className="flex flex-wrap items-center gap-1.5 text-xs text-faint">
                      {/* 求助者语言与协助者界面语言一致时高亮：帮志愿者一眼看到自己最能服务的对象（不改队列顺序，保持先到先得公平）。 */}
                      {r.language && (r.language.toLowerCase() === lang
                        ? <Pill tone="honey">{r.language.toUpperCase()} · {t('你的语言', 'your language')}</Pill>
                        : <Pill>{r.language.toUpperCase()}</Pill>)}
                      {r.locality && <span>{r.locality}</span>}
                      <span>{waited(r.waitedSeconds)}</span>
                    </div>
                  </div>
                  <Button loading={busyId === r.callId} disabled={!!active} onClick={() => onClaim(r)}
                    aria-label={t(`认领 ${r.fromName} 的求助${r.topic ? `（${r.topic}）` : ''}`, `Claim help from ${r.fromName}${r.topic ? ` (${r.topic})` : ''}`)}><IconCheck width={16} height={16} />{t('认领接入', 'Claim')}</Button>
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
