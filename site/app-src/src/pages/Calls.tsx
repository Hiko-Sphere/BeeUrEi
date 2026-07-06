import { useEffect, useRef, useState } from 'react'
import { api, type IncomingCall, type HelpRequest, type CallRecordInfo } from '../lib/api'
import { pollWhileVisible } from '../lib/poll'
import { pickNewHelpRequests, playHelpChime } from '../lib/helpQueueAlert'
import { useI18n } from '../lib/i18n'
import { useCall } from './call/CallController'
import { Card, Avatar, Button, Pill, Spinner, EmptyState, useToast } from '../components/ui'
import { CallHistoryRow } from '../components/CallHistoryRow'
import { IconPhone, IconUsers, IconCheck } from '../components/icons'

/// 求助等待时长（后端给的是 waitedSeconds）：<60s 报秒、<1h 报分钟、≥1h 报"H 小时 M 分钟"。
/// 公开求助最长可在队列滞留到 4 小时 TTL，无人认领时旧实现会显示"已等待 240 分钟"这类难读数——
/// 志愿者据此判断"这位盲人已等很久、该优先接"，小时读法更直观。非有限/负值兜底为 0（不显示 NaN）。
export function formatWaited(seconds: number, t: (z: string, e: string) => string): string {
  const s = Number.isFinite(seconds) ? Math.max(0, Math.floor(seconds)) : 0
  if (s < 60) return t(`已等待 ${s} 秒`, `waited ${s}s`)
  if (s < 3600) return t(`已等待 ${Math.floor(s / 60)} 分钟`, `waited ${Math.floor(s / 60)}m`)
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60)
  return m > 0 ? t(`已等待 ${h} 小时 ${m} 分钟`, `waited ${h}h ${m}m`)
               : t(`已等待 ${h} 小时`, `waited ${h}h`)
}

export function CallsPage() {
  const { t, lang } = useI18n()
  const toast = useToast()
  const { answerIncoming, claimQueue, active } = useCall()
  const [incoming, setIncoming] = useState<IncomingCall[] | null>(null)
  const [queue, setQueue] = useState<HelpRequest[] | null>(null)
  const [history, setHistory] = useState<CallRecordInfo[] | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  // 求助队列"新到"提示：与 iOS 协助端多感知提示对齐（此前 web 端 helpQueueAlert 已建+已测却**从未接线**——
  // 待命志愿者切到别的标签页时，盲人的新求助进队毫无声响，只能干等）。alertedRef 记已提示 id（跨轮询存活、不触发重渲染）。
  const alertedRef = useRef<Set<string>>(new Set())
  const baselinedRef = useRef(false) // 首帧只建基线不响：刚打开页面时已在队列的求助不该突然响铃（你正看着它）；此后新到才响
  const inCall = !!active

  useEffect(() => {
    let alive = true
    const load = async () => {
      const [inc, q, hist] = await Promise.allSettled([api.incomingCalls(), api.helpQueue(), api.callHistory()])
      if (!alive) return
      // 每段独立：成功则更新；失败时——若已有数据则保留(轮询瞬时失败不清屏)，若仍是初始 null 则落为空数组，
      // 退出加载态(否则某个端点持续失败会让该段永远转圈；页面每 4s 轮询，恢复后自然填回)。
      if (inc.status === 'fulfilled') setIncoming(inc.value.calls); else setIncoming((c) => c ?? [])
      if (q.status === 'fulfilled') {
        const reqs = q.value.requests
        setQueue(reqs)
        // 通话中只更新列表、不动 alerted、不出声（同 iOS 复审#3）：否则通话期间到达的求助被标记已提示，
        // 挂断后永不再响——公开求助又无推送兜底，正是本提示要覆盖的场景。挂断后（active 变化重跑 effect）再补响。
        if (!inCall) {
          const { fresh, nextAlerted } = pickNewHelpRequests(reqs, alertedRef.current)
          alertedRef.current = nextAlerted
          if (baselinedRef.current && fresh.length > 0) {
            playHelpChime() // 两声中频短鸣（AudioContext 已处理 suspended；被静音/自动播放拒则 toast 兜底）
            toast(t(`收到 ${fresh.length} 条新求助`, `${fresh.length} new help request${fresh.length > 1 ? 's' : ''}`), 'info')
          }
          baselinedRef.current = true
        }
      } else setQueue((c) => c ?? [])
      if (hist.status === 'fulfilled') setHistory(hist.value.calls); else setHistory((c) => c ?? [])
    }
    void load()
    const stop = pollWhileVisible(load, 4000)
    return () => { alive = false; stop() }
    // 依赖仅 active（同原实现）：t/toast 在会话内稳定，inCall 由 active 派生——active 变化即重跑并捕获最新值。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active])

  const onAnswer = async (c: IncomingCall) => { setBusyId(c.callId); await answerIncoming(c.callId, c.fromName, c.fromAvatar); setBusyId(null) }
  const onClaim = async (r: HelpRequest) => { setBusyId(r.callId); await claimQueue(r.callId, r.fromName || t('求助者', 'Requester'), undefined); setBusyId(null) }
  const waited = (s: number) => formatWaited(s, t)

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
              {history.map((c) => <CallHistoryRow key={c.id} call={c} />)}
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
