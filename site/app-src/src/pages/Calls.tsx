import { useEffect, useRef, useState } from 'react'
import { api, type IncomingCall, type HelpRequest, type CallRecordInfo } from '../lib/api'
import { pollWhileVisible } from '../lib/poll'
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
  const { answerIncoming, claimQueue, active, startOutgoing } = useCall()
  // 通话记录一键回拨：尤其未接的紧急求助只在记录里出现、不进通知列表——直接呼叫，免点进聊天绕一圈。
  const callBack = (c: CallRecordInfo) => { if (c.peerId) void startOutgoing(c.peerId, c.peerName || t('对方', 'Them'), c.peerAvatar ?? null) }
  const [incoming, setIncoming] = useState<IncomingCall[] | null>(null)
  const [queue, setQueue] = useState<HelpRequest[] | null>(null)
  const [history, setHistory] = useState<CallRecordInfo[] | null>(null) // 轮询刷新的首屏（最近 N 条）
  const [olderPages, setOlderPages] = useState<CallRecordInfo[]>([])     // "加载更多"累积的更早通话（不参与轮询，不被刷新覆盖）
  const [hasMore, setHasMore] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const expandedRef = useRef(false) // 是否已加载更多：展开后轮询不再动 hasMore（否则每 4s 把"还有更多"翻回来、闪烁）
  const historyListRef = useRef<HTMLUListElement>(null)
  const pendingFocusRef = useRef<number | null>(null) // 加载更多后须聚焦的行下标（焦点接力）
  const [busyId, setBusyId] = useState<string | null>(null)
  const [matching, setMatching] = useState(false)

  useEffect(() => {
    let alive = true
    const load = async () => {
      const [inc, q, hist] = await Promise.allSettled([api.incomingCalls(), api.helpQueue(), api.callHistory()])
      if (!alive) return
      // 每段独立：成功则更新；失败时——若已有数据则保留(轮询瞬时失败不清屏)，若仍是初始 null 则落为空数组，
      // 退出加载态(否则某个端点持续失败会让该段永远转圈；页面每 4s 轮询，恢复后自然填回)。
      if (inc.status === 'fulfilled') setIncoming(inc.value.calls); else setIncoming((c) => c ?? [])
      // 只更新列表**展示**、不在此响铃/toast：新求助的声音提示由全局 HelpQueueAlertHost 单点负责（它已按"待命中且
      // 不在通话"门控 + 代际去重）。此前本页也响一遍 → 停在通话页时同一条求助**响铃+toast 两次**（且本页还漏查"待命"
      // 门控，未待命也响）。删本页响铃，交全局单点，去重（见对抗复审）。
      if (q.status === 'fulfilled') setQueue(q.value.requests)
      else setQueue((c) => c ?? [])
      // 首屏刷新（最近 N 条）：仅在**未展开**时同步 hasMore——展开后 hasMore 由 loadMore 维护。
      if (hist.status === 'fulfilled') { setHistory(hist.value.calls); if (!expandedRef.current) setHasMore(!!hist.value.hasMore) }
      else setHistory((c) => c ?? [])
    }
    void load()
    const stop = pollWhileVisible(load, 4000)
    return () => { alive = false; stop() }
    // 依赖仅 active（同原实现）：t/toast 在会话内稳定，inCall 由 active 派生——active 变化即重跑并捕获最新值。
     
  }, [active])

  // 合并首屏 + 已加载的更早页；按 id 去重（首屏轮询与更早页理论不重叠——仅 >首屏 才有"加载更多"——但防御性去重）。
  const combinedHistory = (() => {
    const seen = new Set<string>()
    return [...(history ?? []), ...olderPages].filter((c) => (seen.has(c.id) ? false : (seen.add(c.id), true)))
  })()

  // 加载更多：以当前列表最后一条（最早）为游标向前翻页，追加到 olderPages。
  const loadMore = async () => {
    const last = combinedHistory[combinedHistory.length - 1]
    if (!last || loadingMore) return
    setLoadingMore(true)
    expandedRef.current = true
    try {
      const r = await api.callHistory({ before: last.createdAt, beforeId: last.id })
      // 焦点接力（读屏用户"加载更多"后不失位）：记下首条新记录将落在的行下标，追加后由 effect 把焦点移过去——
      // 否则新内容默默出现在下方、且到底时"加载更多"按钮卸载会把焦点丢到 body（同 Chat jumpToMessage 的接力）。
      if (r.calls.length > 0) pendingFocusRef.current = combinedHistory.length
      setOlderPages((p) => [...p, ...r.calls])
      setHasMore(!!r.hasMore)
    } catch { /* 忽略；用户可再点 */ } finally { setLoadingMore(false) }
  }

  // 追加渲染后把焦点移到首条新记录行（tabindex=-1 + focus，同 Chat jumpToMessage）。
  useEffect(() => {
    if (pendingFocusRef.current == null) return
    const el = historyListRef.current?.children[pendingFocusRef.current] as HTMLElement | undefined
    if (el) { el.setAttribute('tabindex', '-1'); el.focus() }
    pendingFocusRef.current = null
  }, [combinedHistory.length])

  const onAnswer = async (c: IncomingCall) => { setBusyId(c.callId); await answerIncoming(c.callId, c.fromName, c.fromAvatar); setBusyId(null) }
  const onClaim = async (r: HelpRequest) => { setBusyId(r.callId); await claimQueue(r.callId, r.fromName || t('求助者', 'Requester'), undefined); setBusyId(null) }
  // 一键匹配（对齐 iOS「帮我匹配」）：服务端原子挑一位等最久的待助者并认领，直接复用 claimQueue 入会
  // （claimHelp 对同一认领者幂等，故匹配后再 claimQueue 不会二次占用/失败）。无人等待则提示、不进空房间。
  const onMatch = async () => {
    if (active || matching) return
    setMatching(true)
    try {
      const { request } = await api.helpMatch()
      if (request) await claimQueue(request.callId, request.fromName || t('求助者', 'Requester'), request.fromAvatar ?? undefined)
      else toast(t('暂时没有等待中的求助', 'No one is waiting right now'), 'info')
    } catch {
      toast(t('匹配失败，请重试', 'Match failed — try again'), 'error')
    } finally {
      setMatching(false)
    }
  }
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
            <>
              {/* 一键匹配：接入等最久的待助者，无需手动扫队列（想挑特定语言/主题者仍可下面手动认领）。 */}
              <div className="border-b border-[var(--line)] px-4 py-3">
                <Button variant="ok" loading={matching} disabled={!!active} onClick={onMatch}
                  aria-label={t('帮我匹配一位等待中的求助者', 'Match me with a waiting requester')}><IconCheck width={16} height={16} />{t('帮我匹配', 'Match me')}</Button>
              </div>
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
            </>
          )}
        </Card>
      </section>

      {/* 通话记录 */}
      <section>
        <SectionHead icon={<IconPhone />} title={t('通话记录', 'Call history')} />
        <Card className="overflow-hidden">
          {history === null ? <Spinner /> : combinedHistory.length === 0 ? (
            <EmptyState icon={<IconPhone />} title={t('暂无记录', 'No history')} />
          ) : (
            <>
              <ul ref={historyListRef} className="divide-y divide-[var(--line)]">
                {combinedHistory.map((c) => <CallHistoryRow key={c.id} call={c} onCall={callBack} callDisabled={!!active} />)}
              </ul>
              {/* 加载更多：通话记录此前硬顶最近 100 条、无从翻看更早（silent cap）。有更早记录时给出翻页入口。 */}
              {hasMore && (
                <div className="border-t border-[var(--line)] p-3 text-center">
                  <Button variant="soft" loading={loadingMore} onClick={loadMore}>{t('加载更多', 'Load more')}</Button>
                </div>
              )}
            </>
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
