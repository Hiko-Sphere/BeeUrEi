import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { api, chatErrorText, fetchMediaObjectURL, uploadMedia, SEARCH_LIMIT, GLOBAL_SEARCH_LIMIT, type ChatMessage, type Conversation, type GroupSummary, type User, type PinnedMessage, type FamilyLink } from '../lib/api'
import { pollWhileVisible } from '../lib/poll'
import { useSession } from '../lib/session'
import { useI18n } from '../lib/i18n'
import { joinNames } from '../lib/listFormat'
import { parseLocation, appleMapsUrl, locationMessageText } from '../lib/location'
import { linkifyParts } from '../lib/linkify'
import { imageFileFromClipboard } from '../lib/clipboardImage'
import { isForwardableKind } from '../lib/chatMessage'
import { isNearBottom } from '../lib/scroll'
import { ReportDialog } from '../components/ReportDialog'
import { VoiceRecorderButton } from '../components/VoiceRecorder'
import { Avatar, Pill, Spinner, EmptyState, useToast, timeAgo, fmtHm, fmtTime, Modal, Button } from '../components/ui'
import { IconChat, IconSend, IconPlus, IconX, IconPin } from '../components/icons'

// jumpTo：打开会话后要跳到并高亮的消息 id（全局消息搜索命中→直达那条消息，而非只落到会话底部）。见 Thread 内 jumpToMessage。
type Selection = { kind: 'peer'; id: string; name: string; avatar?: string | null; muted?: boolean; unread?: number; jumpTo?: string } | { kind: 'group'; id: string; name: string; members: User[]; ownerId: string; muted: boolean; unread?: number; jumpTo?: string }

export function ChatPage() {
  const { peerId, groupId } = useParams()
  const nav = useNavigate()
  const { t, lang } = useI18n()
  const [convos, setConvos] = useState<Conversation[] | null>(null)
  const [groups, setGroups] = useState<GroupSummary[] | null>(null)
  const [sel, setSel] = useState<Selection | null>(null)
  const [createOpen, setCreateOpen] = useState(false)

  const loadLists = useCallback(async () => {
    const [c, g] = await Promise.allSettled([api.conversations(), api.groups()])
    // 失败时：有数据则保留，仍是初始 null 则落空数组退出加载态（避免持续失败让列表永远转圈）。
    if (c.status === 'fulfilled') setConvos(c.value.conversations); else setConvos((v) => v ?? [])
    if (g.status === 'fulfilled') setGroups(g.value.groups); else setGroups((v) => v ?? [])
  }, [])
  useEffect(() => { void loadLists(); return pollWhileVisible(loadLists, 8000) }, [loadLists])

  // 打开会话即乐观清其列表未读徽标（正在看的会话不该再显未读——桌面端列表与线程并排时尤其明显；轮询确认前的桥接）。
  // 也让"读完→切走→8s 内切回"时"新消息"分隔线不再对已读消息重现（下次打开 sel.unread 已为 0）。分隔线本次的
  // unreadAtOpen 已在 Thread 按当次 sel.unread 冻结，此清零只作用于列表徽标与**下次**打开，绝不影响当前分隔线。
  useEffect(() => {
    if (!sel) return
    if (sel.kind === 'peer') setConvos((cur) => cur?.map((c) => (c.peer.id === sel.id && c.unread ? { ...c, unread: 0 } : c)) ?? cur)
    else setGroups((cur) => cur?.map((g) => (g.group.id === sel.id && g.unread ? { ...g, unread: 0 } : g)) ?? cur)
  }, [sel])

  // 由路由 /chat/:peerId 预选单聊对象。**每个 peerId 只预选一次**：effect 依赖 convos（首帧 convos 为
  // null 时要等它到达才能解析对端名），但会话列表每 8s 轮询刷新一次——若不设一次性守卫，每次轮询都会把
  // 用户从其手动打开的另一会话强拉回 URL 里的 peer，丢掉草稿/滚动位置/已加载历史（复审 HIGH）。
  const appliedPeer = useRef<string | null>(null)
  useEffect(() => {
    if (!peerId) { appliedPeer.current = null; return } // 离开单聊路由：允许下次深链同一 peer 再预选
    if (appliedPeer.current === peerId) return           // 本 peerId 已预选过：后续 convos 轮询刷新不再抢回选择
    const c = convos?.find((x) => x.peer.id === peerId)
    if (c) { appliedPeer.current = peerId; setSel({ kind: 'peer', id: peerId, name: c.peer.displayName || t('已注销用户', 'Deactivated user'), avatar: c.peer.avatar, muted: c.muted ?? false, unread: c.unread }) }
    else void api.lookupUser(peerId).then((r) => { if (r.user) { appliedPeer.current = peerId; setSel({ kind: 'peer', id: peerId, name: r.user.displayName, avatar: r.user.avatar }) } }).catch(() => {
      void api.familyLinks().then(({ links }) => { const l = links.find((x) => x.memberId === peerId); if (l) { appliedPeer.current = peerId; setSel({ kind: 'peer', id: peerId, name: l.memberName, avatar: l.memberAvatar }) } })
    })
  }, [peerId, convos])

  // 由路由 /chat/g/:groupId 预选群聊（群消息 web push 点开直达该群，与单聊 /chat/:peerId 对称）。**每个 groupId
  // 只预选一次**（守卫同 appliedPeer）：groups 每 8s 轮询刷新，不设守卫会把用户从手动打开的会话强拉回 URL 里的群、
  // 丢草稿/滚动位置。groups 首帧为 null 时等其到达再解析（群名/成员）；找不到（未在群/已退群）则不选、留在列表。
  const appliedGroup = useRef<string | null>(null)
  useEffect(() => {
    if (!groupId) { appliedGroup.current = null; return }
    if (appliedGroup.current === groupId) return
    const g = groups?.find((x) => x.group.id === groupId)
    if (g) { appliedGroup.current = groupId; setSel({ kind: 'group', id: groupId, name: g.group.name, members: g.members, ownerId: g.group.ownerId, muted: g.muted ?? false, unread: g.unread }) }
  }, [groupId, groups])

  const items = useMemo(() => {
    // 已注销对端：服务端发空 displayName（语言中立）→ 在此单点本地化，下游列表/过滤/点开(sel.name)全继承，
    // 免在多处 c.peer.displayName 各自兜底（i18n 收口）。
    const a = (convos ?? []).map((raw) => {
      const c = raw.peer.displayName ? raw : { ...raw, peer: { ...raw.peer, displayName: t('已注销用户', 'Deactivated user') } }
      return { key: `p:${c.peer.id}`, ts: c.last?.createdAt ?? 0, render: () => c, kind: 'peer' as const, c }
    })
    const b = (groups ?? []).map((g) => ({ key: `g:${g.group.id}`, ts: g.last?.createdAt ?? g.group.createdAt, kind: 'group' as const, g }))
    return [...a, ...b].sort((x, y) => y.ts - x.ts)
  }, [convos, groups, t])

  // 会话列表按名字过滤：联系人/群一多，免逐条 Tab/滚动找人（对读屏用户尤其省事——键入即缩到匹配项）。各主流 IM 标配。
  const [convoQuery, setConvoQuery] = useState('')
  const shown = useMemo(() => {
    const q = convoQuery.trim().toLowerCase()
    if (!q) return items
    return items.filter((it) => (it.kind === 'peer' ? it.c.peer.displayName : it.g.group.name).toLowerCase().includes(q))
  }, [items, convoQuery])

  // 跨会话全局消息搜索（WhatsApp 式）：同一个搜索框在按名字过滤会话之外，同时搜**全部**会话的消息正文——
  // "那个地址在哪个对话里"不必逐个打开找。≥2 字才查 + 0.35s 防抖（与线程内搜索同款）；点击命中直接打开对应会话。
  const { user: meUser } = useSession()
  const [msgHits, setMsgHits] = useState<ChatMessage[] | null>(null)
  useEffect(() => {
    const q = convoQuery.trim()
    if (q.length < 2) { setMsgHits(null); return }
    let stale = false
    const timer = setTimeout(() => {
      void api.searchAllMessages(q).then((r) => { if (!stale) setMsgHits(r.messages) }).catch(() => { if (!stale) setMsgHits([]) })
    }, 350)
    return () => { stale = true; clearTimeout(timer) }
  }, [convoQuery])
  // 命中 → 可打开的会话目标（群按 groupId、单聊按对端 id 在已加载列表里解析名字；解析不到的不渲染，避免死行）。
  const hitTarget = (m: ChatMessage): { key: string; name: string; open: () => void } | null => {
    if (m.groupId) {
      const g = (groups ?? []).find((x) => x.group.id === m.groupId)
      return g ? { key: `g:${m.id}`, name: g.group.name, open: () => setSel({ kind: 'group', id: g.group.id, name: g.group.name, members: g.members, ownerId: g.group.ownerId, muted: g.muted ?? false, jumpTo: m.id }) } : null
    }
    const pid = m.fromId === meUser?.id ? m.toId : m.fromId
    const c = (convos ?? []).find((x) => x.peer.id === pid)
    if (!c) return null
    const nm = c.peer.displayName || t('已注销用户', 'Deactivated user') // 已注销对端服务端发空名：与 items 同源本地化，免命中行空名/aria-label 残缺
    return { key: `p:${m.id}`, name: nm, open: () => setSel({ kind: 'peer', id: pid, name: nm, avatar: c.peer.avatar, muted: c.muted ?? false, jumpTo: m.id }) }
  }

  const back = () => { setSel(null); if (peerId) nav('/chat') }

  return (
    <div className="flex h-[calc(100dvh-7.5rem)] gap-4 md:h-[calc(100dvh-6rem)]">
      {/* 会话列表 */}
      <aside className={`w-full shrink-0 flex-col md:flex md:w-80 ${sel ? 'hidden md:flex' : 'flex'}`}>
        <div className="mb-3 flex items-center justify-between">
          <h1 className="text-xl font-bold tracking-tight">{t('消息', 'Messages')}</h1>
          <button onClick={() => setCreateOpen(true)} className="flex items-center gap-1 rounded-lg surface-2 px-2.5 py-1.5 text-xs font-medium text-soft hover:brightness-105"><IconPlus width={14} height={14} />{t('建群', 'New group')}</button>
        </div>
        {items.length > 0 && (
          <div className="mb-2">
            <input type="search" value={convoQuery} onChange={(e) => setConvoQuery(e.target.value)}
              placeholder={t('搜索会话', 'Search conversations')} aria-label={t('搜索会话', 'Search conversations')}
              className="w-full rounded-xl surface-2 px-3 py-2 text-sm outline-none placeholder:text-faint focus:ring-2 focus:ring-[var(--color-honey)]/40" />
          </div>
        )}
        <div tabIndex={0} aria-label={t('会话列表', 'Conversation list')}
          className="surface flex-1 overflow-y-auto rounded-2xl border border-[var(--line)]">
          {convos === null && groups === null ? <Spinner /> : items.length === 0 ? (
            <EmptyState icon={<IconChat />} title={t('暂无会话', 'No conversations')} message={t('从联系人页发起聊天', 'Start from Contacts')} />
          ) : shown.length === 0 ? (
            <p className="px-4 py-6 text-center text-sm text-faint" role="status">{t('没有匹配的会话', 'No matching conversations')}</p>
          ) : (
            <ul className="divide-y divide-[var(--line)]">
              {shown.map((it) => it.kind === 'peer' ? (
                <ConvoRow key={it.key} active={sel?.kind === 'peer' && sel.id === it.c.peer.id} convo={it.c} lang={lang} t={t} meId={meUser?.id}
                  onClick={() => setSel({ kind: 'peer', id: it.c.peer.id, name: it.c.peer.displayName, avatar: it.c.peer.avatar, muted: it.c.muted ?? false, unread: it.c.unread })} />
              ) : (
                <GroupRow key={it.key} active={sel?.kind === 'group' && sel.id === it.g.group.id} g={it.g} lang={lang} t={t} meId={meUser?.id}
                  onClick={() => setSel({ kind: 'group', id: it.g.group.id, name: it.g.group.name, members: it.g.members, ownerId: it.g.group.ownerId, muted: it.g.muted ?? false, unread: it.g.unread })} />
              ))}
            </ul>
          )}
          {/* 全局消息命中（与上方"按名字过滤的会话"并列）：点击直达对应会话。解析不到会话的命中不渲染。 */}
          {msgHits && msgHits.length > 0 && (() => {
            const rows = msgHits.map((m) => ({ m, tgt: hitTarget(m) })).filter((x): x is { m: ChatMessage; tgt: NonNullable<ReturnType<typeof hitTarget>> } => x.tgt !== null)
            if (rows.length === 0) return null
            return (
              <div className="border-t border-[var(--line)]">
                <h2 className="px-3 pb-1 pt-3 text-xs font-semibold text-faint">{t('消息', 'Messages')}</h2>
                <ul className="divide-y divide-[var(--line)]">
                  {rows.map(({ m, tgt }) => (
                    <li key={tgt.key}>
                      <button type="button" onClick={tgt.open} className="w-full px-3 py-2.5 text-left transition hover:surface-2"
                        aria-label={t(`打开与 ${tgt.name} 的会话`, `Open conversation with ${tgt.name}`)}>
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="truncate text-sm font-medium">{tgt.name}</span>
                          <span className="shrink-0 text-[10px] text-faint">{timeAgo(m.createdAt, lang)}</span>
                        </div>
                        <div className="truncate text-xs text-faint">{m.text}</div>
                      </button>
                    </li>
                  ))}
                </ul>
                {/* 诚实截断（no-silent-caps）：按**服务端原始条数** msgHits 判断（rows 经会话解析过滤会更少，
                    据 rows 判会漏标）；打满 GLOBAL_SEARCH_LIMIT 即可能还有更早的匹配未显示。 */}
                {msgHits.length >= GLOBAL_SEARCH_LIMIT && (
                  <p className="px-3 pb-2 pt-1 text-[11px] text-faint">{t(`仅显示最近 ${GLOBAL_SEARCH_LIMIT} 条匹配，可能还有更早的`, `Showing the ${GLOBAL_SEARCH_LIMIT} most recent matches — older ones may exist`)}</p>
                )}
              </div>
            )
          })()}
        </div>
      </aside>

      {/* 对话窗格 */}
      <section className={`min-w-0 flex-1 ${sel ? 'flex' : 'hidden md:flex'}`}>
        {sel ? <Thread key={`${sel.kind}:${sel.id}`} sel={sel} onBack={back} onSent={loadLists}
            peerOnline={sel.kind === 'peer' ? ((convos ?? []).find((c) => c.peer.id === sel.id)?.online ?? false) : false} />
          : <div className="flex w-full items-center justify-center rounded-2xl surface border border-[var(--line)] text-faint">{t('选择一个会话开始聊天', 'Select a conversation')}</div>}
      </section>

      {createOpen && <CreateGroupDialog onClose={() => setCreateOpen(false)} onCreated={() => { setCreateOpen(false); void loadLists() }} />}
    </div>
  )
}

function ConvoRow({ convo, active, onClick, lang, t, meId }: { convo: Conversation; active: boolean; onClick: () => void; lang: 'zh' | 'en'; t: (z: string, e: string) => string; meId?: string }) {
  return (
    // 行内容包一层 <button>：<li> 保留 listitem 语义，按钮天然可 Tab 聚焦 + Enter/Space 激活
    // （键盘/读屏用户此前无法选择会话——onClick 挂在 li 上对键盘完全不可达）。
    <li className={active ? 'surface-2' : ''}>
      <button type="button" onClick={onClick} className="flex w-full items-center gap-3 px-3 py-3 text-left transition hover:surface-2">
        <Avatar name={convo.peer.displayName} src={convo.peer.avatar} size={44} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            {/* 在线圆点（读屏念"在线"）：与亲友列表同口径，聊天列表一眼分清可即时呼叫 vs 只能留言。 */}
            {convo.online && <span role="img" aria-label={t('在线', 'Online')} title={t('在线', 'Online')} className="h-2 w-2 shrink-0 rounded-full bg-ok" />}
            <span className="truncate font-medium">{convo.peer.displayName}</span>
            {convo.muted && <span role="img" aria-label={t('已静音', 'Muted')} title={t('已静音', 'Muted')} className="shrink-0 text-xs text-faint">🔕</span>}</div>
          <div className="truncate text-xs text-faint">{conversationPreview(convo.last, meId, t)}</div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className="text-[10px] text-faint">{convo.last ? timeAgo(convo.last.createdAt, lang) : ''}</span>
          {convo.unread > 0 && <span data-testid="convo-unread" className="rounded-full bg-honey px-1.5 text-[10px] font-bold text-ink">{convo.unread}</span>}
        </div>
      </button>
    </li>
  )
}
function GroupRow({ g, active, onClick, lang, t, meId }: { g: GroupSummary; active: boolean; onClick: () => void; lang: 'zh' | 'en'; t: (z: string, e: string) => string; meId?: string }) {
  return (
    <li className={active ? 'surface-2' : ''}>
      <button type="button" onClick={onClick} className="flex w-full items-center gap-3 px-3 py-3 text-left transition hover:surface-2">
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-honey/15 text-honey"><IconChat /></span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5"><span className="truncate font-medium">{g.group.name}</span><Pill>{g.members.length}</Pill>
            {g.muted && <span role="img" aria-label={t('已静音', 'Muted')} title={t('已静音', 'Muted')} className="shrink-0 text-xs text-faint">🔕</span>}</div>
          <div className="truncate text-xs text-faint">{conversationPreview(g.last, meId, t, g.members)}</div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className="text-[10px] text-faint">{g.last ? timeAgo(g.last.createdAt, lang) : ''}</span>
          {g.unread > 0 && <span className="rounded-full bg-honey px-1.5 text-[10px] font-bold text-ink">{g.unread}</span>}
        </div>
      </button>
    </li>
  )
}

/// 会话列表末条预览的**发送者前缀**（WhatsApp/iMessage/Telegram 等标配，便于一眼分清"我发的·在等对方回" vs
/// "对方发的·在等我回"，协助者管理多会话时尤其省事）：我发的→"你："；群里别人发的→"{发送者名}："；单聊对端发的→
/// 无前缀（行首已显对端名，再加冗余）。撤回消息 [已撤回] 自足、不加前缀（"你：[已撤回]"读着别扭）。纯函数，可单测。
export function conversationPreview(
  last: ChatMessage | null,
  meId: string | undefined,
  t: (z: string, e: string) => string,
  members?: User[],
): string {
  const body = preview(last, t)
  if (!last || last.kind === 'recalled') return body
  if (last.fromId === meId) return t(`你：${body}`, `You: ${body}`)
  if (members) { const s = members.find((mm) => mm.id === last.fromId); if (s?.displayName) return t(`${s.displayName}：${body}`, `${s.displayName}: ${body}`) }
  return body
}

/// 两个时间戳是否同一**本地**日历日（日期分隔用；本地时区，跨天以用户所见的午夜为界）。
function sameLocalDay(a: number, b: number): boolean {
  const x = new Date(a), y = new Date(b)
  return x.getFullYear() === y.getFullYear() && x.getMonth() === y.getMonth() && x.getDate() === y.getDate()
}
/// 消息前是否需要插入日期分隔（第一条前总插；与上一条不同本地日则插）。纯函数，可单测。
export function needsDateSeparator(ts: number, prevTs: number | null): boolean {
  return prevTs === null || !sameLocalDay(ts, prevTs)
}
/// 日期分隔标签（IM 标配）：今天/昨天/更早则本地化长日期。纯函数、now 注入，可单测。
export function dateSeparatorLabel(ts: number, now: number, lang: 'zh' | 'en'): string {
  if (sameLocalDay(ts, now)) return lang === 'en' ? 'Today' : '今天'
  const y = new Date(now); y.setDate(y.getDate() - 1) // setDate 负溢出自动跨月/年
  if (sameLocalDay(ts, y.getTime())) return lang === 'en' ? 'Yesterday' : '昨天'
  return new Date(ts).toLocaleDateString(lang === 'en' ? 'en-US' : 'zh-CN', { year: 'numeric', month: 'long', day: 'numeric' })
}

/// "新消息"分隔位置（IM 标配：打开会话一眼定位上次读到哪）：返回**第一条未读对端消息**的 id。
/// 未读=打开会话那一刻服务端给的未读计数（unreadCount/群 unreadGroupCount，均为"非己发∧非撤回∧读游标之后"）——
/// 即从末尾往前数 unreadCount 条"非己发∧非撤回"消息里最早的那条，其前即分隔线位。无未读→null。若已加载的对端
/// 消息不足 unreadCount（部分未读更早、不在窗口）→ 取已加载最早一条对端消息（分隔线落窗口顶，仍诚实标"以下是新的"）。
/// 纯函数、可单测（与服务端未读口径一致：只数非己发非撤回）。
export function firstUnreadMessageId(msgs: ChatMessage[], myId: string | undefined, unreadCount: number): string | null {
  if (unreadCount <= 0) return null
  let peerCount = 0
  let firstId: string | null = null
  for (let i = msgs.length - 1; i >= 0; i--) {
    const m = msgs[i]
    if (m.fromId !== myId && m.kind !== 'recalled') {
      peerCount++
      firstId = m.id
      if (peerCount >= unreadCount) return firstId
    }
  }
  return firstId
}

// 「新消息是否自动滚到底」的判据 isNearBottom 抽到 lib/scroll（与通话内实时文字 RTT 共用，见 CallScreen），
// 本模块由顶部 import 使用；单测见 ChatAnnounce.test.ts（直接测 lib/scroll）。

function preview(m: ChatMessage | null, t: (z: string, e: string) => string): string {
  if (!m) return t('暂无消息', 'No messages')
  switch (m.kind) {
    case 'image': return t('[图片]', '[Photo]')
    case 'audio': return t('[语音]', '[Voice]')
    case 'video': return t('[视频]', '[Video]')
    case 'location': return t('[位置]', '[Location]')
    case 'recalled': return t('[已撤回]', '[Recalled]')
    default:
      // 文本式位置（iOS 默认）在列表里也显示成 [位置]，而非一串裸 URL。
      if (parseLocation(m.text)) return t('[位置]', '[Location]')
      return m.text
  }
}

export type AnnounceState = { id: string | null; initialized: boolean }
/// 决定聊天线程该向读屏播报什么——只播"会话进行中新到的对端消息"。纯函数，可单测。
/// 规则：① 未初始化（刚进会话/刚加载完历史）只记录末尾基线、不播报（否则一进来就念历史最后一条）；
/// ② 末尾 id 未变不播报（上翻"加载更早"只改列表头部，末尾不动）；③ 新末尾若是自己发的不播报；
/// ④ 会话本空、对端发来第一条：此时已 initialized、末尾 id 从 null 变为新 id → 正常播报（不被①吞掉）。
export function nextChatAnnouncement(
  lastMsg: ChatMessage | null,
  state: AnnounceState,
  myId: string | undefined,
  describe: (m: ChatMessage) => string,
): { text: string | null; state: AnnounceState } {
  if (!state.initialized) return { text: null, state: { id: lastMsg?.id ?? null, initialized: true } }
  if (!lastMsg || lastMsg.id === state.id) return { text: null, state }
  const next: AnnounceState = { id: lastMsg.id, initialized: true }
  if (lastMsg.fromId === myId) return { text: null, state: next } // 自己发的不念
  // 首次见到即已撤回（对端在本端轮询看到原消息前就撤回）：念"[已撤回]"对读屏是无意义噪声，跳过
  // （与 iOS refresh 同口径：kind==recalled 不播报，但 state 仍前进以免卡住后续消息）。
  if (lastMsg.kind === 'recalled') return { text: null, state: next }
  return { text: describe(lastMsg), state: next }
}

/// 轮询窗口与已加载历史合并：以最新窗口 fresh 为准，补回不在其中的更早历史 existing（上翻加载的），
/// 按 id 去重（重叠以 fresh/服务器为准）、(createdAt,id) 升序稳定排序。纯函数，可单测。
/// 无 extra 时直接返回 fresh，避免每次轮询都重排（引用稳定，减少无谓渲染）。
export function mergeMessagesStable(fresh: ChatMessage[], existing: ChatMessage[] | null): ChatMessage[] {
  if (!existing || existing.length === 0) return fresh
  const ids = new Set(fresh.map((m) => m.id))
  const extra = existing.filter((m) => !ids.has(m.id))
  return extra.length ? [...fresh, ...extra].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id)) : fresh
}

// 把一页**更早**消息并入当前列表（按 id 去重、按 createdAt+id 稳定排序）：loadEarlier 上翻分页与
// jumpToMessage 回溯定位共用同一合并，防两处逻辑漂移。重叠 id 保留已有那条（既有可能是编辑后的更新版）。
export function mergeOlder(older: ChatMessage[], existing: ChatMessage[] | null): ChatMessage[] {
  const byId = new Map<string, ChatMessage>()
  for (const m of [...older, ...(existing ?? [])]) byId.set(m.id, m)
  return [...byId.values()].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
}

function Thread({ sel, onBack, onSent, peerOnline }: { sel: Selection; onBack: () => void; onSent: () => void; peerOnline?: boolean }) {
  const { user } = useSession()
  const { t, lang } = useI18n()
  const toast = useToast()
  const [msgs, setMsgs] = useState<ChatMessage[] | null>(null)
  const [pinned, setPinned] = useState<PinnedMessage | null>(null) // 会话置顶消息（顶部横幅）；服务端每次回带最新
  // 会话草稿本地键：按**当前用户 + 会话**命名空间，避免同一浏览器换账号后串读到别人的草稿（隐私）。
  const draftKey = `beeurei:draft:${user?.id ?? 'anon'}:${sel.kind}:${sel.id}`
  // 草稿持久化：未发送的输入按会话存 localStorage，切会话(Thread 重挂载)/刷新/误触返回都不丢。
  // 读屏/键盘输入比触屏慢、丢草稿代价更高——各主流 IM 皆有此能力。惰性初始化：进会话即回填上次草稿。
  const [text, setText] = useState(() => { try { return localStorage.getItem(draftKey) ?? '' } catch { return '' } })
  const [sending, setSending] = useState(false)
  const [showInfo, setShowInfo] = useState(false)
  const [reportOpen, setReportOpen] = useState(false) // 单聊举报对方（骚扰常发生在聊天里，就地可举报，不必进联系人页/通话中）
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<ChatMessage[] | null>(null)
  const [loadingEarlier, setLoadingEarlier] = useState(false)
  const [reachedStart, setReachedStart] = useState(false)
  const [replyingTo, setReplyingTo] = useState<ChatMessage | null>(null) // 正在引用回复的消息
  const [forwarding, setForwarding] = useState<ChatMessage | null>(null) // 正在转发的消息（打开目标选择器）
  const [muted, setMuted] = useState(sel.muted ?? false) // 会话免打扰（群/单聊通用；乐观切换 + 回滚）
  const bottomRef = useRef<HTMLDivElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  // 用户是否在底部附近；新消息仅在此才自动滚到底（上翻看历史不被拽走）。带 jumpTo（从全局搜索命中打开）时初始置
  // false：不先把视图强拽到底再跳，避免"闪一下底部再跳到命中处"的跳动——直接由 jumpTo 效应定位到命中消息。
  const nearBottomRef = useRef(sel.jumpTo == null)
  const msgsRef = useRef<ChatMessage[] | null>(null) // 最新 msgs 的镜像：供 jumpToMessage 回溯分页时无闭包陈旧地取当前最旧游标
  const [jumping, setJumping] = useState(false) // 正在为跳转回溯加载更早历史（搜索/引用/置顶跳到未加载的旧消息）
  const onMsgScroll = () => { if (scrollRef.current) nearBottomRef.current = isNearBottom(scrollRef.current) }
  const fileRef = useRef<HTMLInputElement>(null)
  // 点引用预览 → 跳到并短暂高亮原消息（WhatsApp/iMessage 标配：回看长对话时不必手动翻找被引的那条）。
  const [highlightId, setHighlightId] = useState<string | null>(null)
  const PAGE = 50 // 与后端单次返回条数一致

  // "新消息"分隔线（IM 标配）：打开会话那一刻的未读数 → 第一条未读对端消息 id，**计算一次并冻结**——之后 markRead
  // 会把计数清零、轮询会不断进新消息，若每次重算分隔线会乱跳/消失。Thread 按会话 key 重挂载，故冻结天然是"每会话一次"。
  const unreadAtOpen = useState(() => sel.unread ?? 0)[0]
  const [firstUnreadId, setFirstUnreadId] = useState<string | null>(null)
  const unreadComputed = useRef(false)
  useEffect(() => {
    if (unreadComputed.current || !msgs || msgs.length === 0) return
    unreadComputed.current = true // 只认第一次加载完的消息窗口，之后不再动分隔线
    if (unreadAtOpen > 0) setFirstUnreadId(firstUnreadMessageId(msgs, user?.id, unreadAtOpen))
  }, [msgs, user?.id, unreadAtOpen])

  // 输入变化即写草稿；清空(发送成功→setText('')/手动清空)即删键。隐私模式/配额满仅丢失持久化，绝不影响发送本身。
  useEffect(() => {
    try { if (text) localStorage.setItem(draftKey, text); else localStorage.removeItem(draftKey) } catch { /* best-effort */ }
  }, [text, draftKey])

  // 会话免打扰切换（群/单聊通用）：乐观更新即时反馈，失败回滚 + 提示；成功后刷新列表让行内🔕标记同步。
  const toggleMute = async () => {
    const next = !muted
    setMuted(next)
    try {
      if (sel.kind === 'group') await api.muteGroup(sel.id, next)
      else await api.muteConversation(sel.id, next)
      onSent()
    } catch (e) { setMuted(!next); toast(chatErrorText(e, t, t('操作失败', 'Failed')), 'error') }
  }

  const fetchWindow = useCallback((before?: number, beforeId?: string) =>
    sel.kind === 'peer' ? api.messagesWith(sel.id, before, beforeId) : api.groupMessages(sel.id, before, beforeId), [sel])

  const load = useCallback(async () => {
    try {
      const r = await fetchWindow()
      // 合并保留已加载的更早历史（Thread 带 key，切会话会重挂载，cur 只含本会话消息）：
      // 否则每 5s 轮询会把上翻加载的旧消息冲掉。重叠 id 以服务器为准。见 mergeMessagesStable。
      setMsgs((cur) => mergeMessagesStable(r.messages, cur))
      setPinned(r.pinned ?? null) // 置顶随每次轮询刷新（他人置顶/取消/撤回自愈即时反映）
      if (sel.kind === 'peer') void api.markRead(sel.id).catch(() => {})
      else void api.markGroupRead(sel.id).catch(() => {})
    } catch { setMsgs((cur) => cur ?? []) }
  }, [sel, fetchWindow])

  const loadEarlier = useCallback(async () => {
    const oldest = msgs?.[0]
    if (!oldest || loadingEarlier) return
    setLoadingEarlier(true)
    try {
      const r = await fetchWindow(oldest.createdAt, oldest.id)
      if (r.messages.length === 0) { setReachedStart(true); return }
      setMsgs((cur) => mergeOlder(r.messages, cur))
      if (r.messages.length < PAGE) setReachedStart(true) // 不足一页 = 已到对话开头
    } catch { /* 失败下次再试 */ } finally { setLoadingEarlier(false) }
  }, [msgs, loadingEarlier, fetchWindow])

  useEffect(() => { msgsRef.current = msgs }, [msgs]) // 镜像最新 msgs，供 jumpToMessage 回溯分页取当前游标

  // 跳到并短暂高亮某条消息（搜索命中/点引用/点置顶横幅共用）。若目标不在当前已加载窗口（更早的历史），
  // 先**向前回溯分页**逐页载入直到该条进入列表或到达对话开头（上限保护），再定位——这样跳转对**任意历史深度**
  // 都生效（WhatsApp/Telegram 口径：搜索到很旧的消息也能点进去看上下文）。高亮基于"已载入"而非 DOM 时序，测试可确定。
  const jumpToMessage = useCallback(async (id: string) => {
    let loaded = !!msgsRef.current?.some((m) => m.id === id)
    if (!loaded) {
      setJumping(true)
      try {
        let acc = msgsRef.current ?? []
        for (let i = 0; i < 60 && !loaded; i++) { // 60 页×50 = 3000 条回溯上限，防坏数据无限翻页
          const oldest = acc[0]
          if (!oldest) break
          const r = await fetchWindow(oldest.createdAt, oldest.id)
          if (r.messages.length === 0) { setReachedStart(true); break }
          acc = mergeOlder(r.messages, acc) // 本地游标推进
          setMsgs((cur) => mergeOlder(r.messages, cur)) // 函数式并入，不覆盖并发轮询新增的消息
          loaded = r.messages.some((m) => m.id === id)
          if (r.messages.length < PAGE) { setReachedStart(true); break } // 不足一页 = 已到开头
        }
      } catch { /* 加载失败：落到下方"找不到"提示 */ } finally { setJumping(false) }
    }
    if (!loaded) { toast(t('找不到这条消息，可能已被删除', "Can't find that message — it may have been deleted"), 'info'); return }
    setHighlightId(id)
    setTimeout(() => { // 让新载入的消息挂上 DOM 再定位（滚动为锦上添花，jsdom 无此 API，守卫防崩）
      const el = document.getElementById(`msg-${id}`)
      if (!el) return
      if (typeof el.scrollIntoView === 'function') el.scrollIntoView({ block: 'center', behavior: 'smooth' })
      // 焦点移到目标消息（skip-link 同款范式）：搜索面板关闭后焦点会丢到 body，读屏用户"跳到了"却什么也听不到。
      // tabindex=-1 允许编程聚焦（不进 Tab 序）；preventScroll 防与上面的平滑滚动打架。视觉高亮已有（bg-honey/15）。
      el.setAttribute('tabindex', '-1')
      ;(el as HTMLElement).focus({ preventScroll: true })
    }, 0)
    setTimeout(() => setHighlightId((cur) => (cur === id ? null : cur)), 1600) // 到时清高亮（若期间又跳别处则不动新的）
  }, [fetchWindow, toast, t])

  useEffect(() => { void load(); return pollWhileVisible(load, 5000) }, [load])

  // 从全局消息搜索命中打开会话时（sel.jumpTo）：首屏消息加载完后跳到并高亮那条命中消息（更早未加载则回溯分页
  // 载入，见 jumpToMessage）——否则只落到会话底部，用户还得在会话里再搜一次（与线程内搜索命中同一"直达"口径）。
  // 每个 jumpTo 目标只跳一次：防 5s 轮询刷新 msgs 时反复重跳、把用户从正在看的位置反复拽回。
  const jumpedForRef = useRef<string | null>(null)
  useEffect(() => {
    if (!sel.jumpTo || msgs === null) return // 等首屏消息加载完（msgsRef 有值）再跳
    if (jumpedForRef.current === sel.jumpTo) return
    jumpedForRef.current = sel.jumpTo
    void jumpToMessage(sel.jumpTo)
  }, [sel.jumpTo, msgs, jumpToMessage])

  // 仅在**最新一条**变化时滚到底（新消息）；上翻加载更早消息时 last 不变，不应跳到底部。
  const lastId = msgs && msgs.length ? msgs[msgs.length - 1].id : null
  // 新末尾变化即滚到底——**但仅当用户已在底部附近**（在底部聊天/刚进会话），上翻看历史时不打断。首帧 nearBottom
  // 默认 true → 进会话正常落到底。发送自己消息走 send() 里强制置 true（一定看到自己刚发的）。
  useEffect(() => { if (nearBottomRef.current) bottomRef.current?.scrollIntoView({ block: 'end' }) }, [lastId])
  const canLoadEarlier = (msgs?.length ?? 0) >= PAGE && !reachedStart

  // 会话内搜索：输入防抖 0.35s 调后端搜索端点。
  // stale 守卫：cleanup 只能清未触发的 timer，不能取消已发出的请求；连续搜索时旧查询若晚返回会覆盖新结果
  // （乱序竞态，与 iOS MessageSearchSheet 的 Task.cancel 守卫对齐）——故仅当本次 effect 未被取代时才写入 state。
  useEffect(() => {
    const q = searchQuery.trim()
    if (!searchOpen || !q) { setSearchResults(q ? [] : null); return }
    let stale = false
    const id = setTimeout(() => {
      void api.searchMessages(sel.kind === 'group' ? { groupId: sel.id } : { peerId: sel.id }, q)
        .then((r) => { if (!stale) setSearchResults(r.messages) }).catch(() => { if (!stale) setSearchResults([]) })
    }, 350)
    return () => { stale = true; clearTimeout(id) }
  }, [searchQuery, searchOpen, sel])

  // 新消息读屏播报：仅"会话进行中新到的对端消息"写入下方隐藏 aria-live 区（规则见 nextChatAnnouncement）。
  const announceRef = useRef<AnnounceState>({ id: null, initialized: false })
  const announceSeq = useRef(0)
  const [announce, setAnnounce] = useState('')
  useEffect(() => {
    const lastMsg = msgs && msgs.length ? msgs[msgs.length - 1] : null
    const describe = (m: ChatMessage) => {
      const who = sel.kind === 'group'
        ? (sel.members.find((mm) => mm.id === m.fromId)?.displayName ?? t('成员', 'Member'))
        : sel.name
      return `${who}：${preview(m, t)}`
    }
    const r = nextChatAnnouncement(lastMsg, announceRef.current, user?.id, describe)
    announceRef.current = r.state
    // 交替零宽字符：连续两条内容相同的消息也构成 DOM 文本变化，确保读屏不吞掉第二条。
    if (r.text !== null) { announceSeq.current += 1; setAnnounce(r.text + (announceSeq.current % 2 ? '\u200B' : '')) }
  }, [msgs, sel, user?.id, t])

  const target = sel.kind === 'peer' ? { toId: sel.id } : { groupId: sel.id }

  const send = async () => {
    const body = text.trim()
    if (!body || sending) return
    setSending(true)
    nearBottomRef.current = true // 发出自己的消息 → 一定滚到底看到它（即便此前上翻着历史）
    try { await api.sendMessage(target, 'text', body, replyingTo?.id); setText(''); setReplyingTo(null); await load(); onSent() }
    catch (e) { toast(chatErrorText(e, t), 'error') } finally { setSending(false) }
  }

  const sendImage = async (file: File) => {
    setSending(true)
    try {
      const dataUrl = await downscaleImage(file)
      await api.sendMessage(target, 'image', dataUrl)
      await load(); onSent()
    } catch (e) { toast(chatErrorText(e, t, t('图片发送失败', 'Failed to send image')), 'error') } finally { setSending(false) }
  }

  // 发送视频（与 iOS 双向对齐）：原始二进制上传服务器磁盘 → 拿 mediaId 发 kind=video。
  const sendVideo = async (file: File) => {
    if (file.size > 50 * 1024 * 1024) { // 与服务端 MAX_MEDIA_BYTES 一致，发前预检免白等上传
      toast(t('视频太大（上限 50MB），请选短一点的', 'Video too large (50MB max) — pick a shorter one'), 'error'); return
    }
    setSending(true)
    try {
      const mediaId = await uploadMedia(file, file.type || 'video/mp4')
      await api.sendMessage(target, 'video', mediaId)
      await load(); onSent()
    } catch (e) { toast(chatErrorText(e, t, t('视频发送失败', 'Failed to send video')), 'error') } finally { setSending(false) }
  }

  // 发送语音消息（补齐 iOS 早有的语音：此前 web 只能收听不能回发）：VoiceRecorderButton 录成
  // audio/mp4 data URL（AAC——iOS AVAudioPlayer 可播；webm/opus 它播不了，服务端也只收 AAC 家族）。
  const sendAudio = async (dataUrl: string) => {
    setSending(true)
    nearBottomRef.current = true // 同 send()：发出自己的消息滚到底看到它
    try { await api.sendMessage(target, 'audio', dataUrl); await load(); onSent() }
    catch (e) { toast(chatErrorText(e, t, t('语音发送失败', 'Failed to send voice message')), 'error') } finally { setSending(false) }
  }

  // 发送我的当前位置（补齐 iOS 早有的 sendLocation）：取浏览器定位 → 发与 iOS 同口径的位置文本，
  // 两端都渲染成位置气泡。协助者/家人在聊天里一句"我在这"即分享落点，免口述经纬度。
  const sendLocation = () => {
    if (!('geolocation' in navigator)) { toast(t('当前浏览器不支持定位', 'Geolocation not supported'), 'error'); return }
    setSending(true)
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const body = locationMessageText(pos.coords.latitude, pos.coords.longitude)
        if (!body) { setSending(false); toast(t('定位无效，请重试', 'Invalid location — try again'), 'error'); return }
        try { await api.sendMessage(target, 'text', body); await load(); onSent() }
        catch (e) { toast(chatErrorText(e, t, t('位置发送失败', 'Failed to send location')), 'error') } finally { setSending(false) }
      },
      () => { setSending(false); toast(t('无法获取位置，请检查定位权限', 'Could not get location — check location permission'), 'error') },
      { enableHighAccuracy: true, timeout: 10_000, maximumAge: 30_000 },
    )
  }

  const recall = async (m: ChatMessage) => {
    try { await api.recallMessage(m.id); await load() } catch (e) { toast(chatErrorText(e, t, t('撤回失败', 'Recall failed')), 'error') }
  }

  // 编辑自己的文字消息（限 15 分钟内）：改内容并标"已编辑"。
  const edit = async (m: ChatMessage, newText: string) => {
    const body = newText.trim()
    if (!body || body === m.text) return
    try { await api.editMessage(m.id, body); await load() } catch (e) { toast(chatErrorText(e, t, t('编辑失败', 'Edit failed')), 'error') }
  }

  // 表情回应（逐用户）：点我已选的那个=取消；点别的=改成它（每人至多一个，后端替换）。后端空串=清除本人的。
  const react = async (m: ChatMessage, emoji: string) => {
    const mine = m.reactions?.find((r) => r.mine)?.emoji
    try { await api.reactMessage(m.id, mine === emoji ? '' : emoji); await load() }
    catch (e) { toast(chatErrorText(e, t, t('操作失败', 'Failed')), 'error') }
  }

  // 置顶/取消置顶（每会话至多一条）：置顶把该消息钉到顶部横幅；乐观更新后 load 以服务端权威回带为准。
  const pin = async (m: ChatMessage) => {
    setPinned({ ...m }) // 乐观：立即钉上
    try { const r = await api.pinMessage(m.id); setPinned(r.pinned); toast(t('已置顶', 'Pinned'), 'ok'); void load() }
    catch (e) { toast(chatErrorText(e, t, t('置顶失败', 'Pin failed')), 'error'); void load() }
  }
  const unpin = async () => {
    const target = pinned?.id
    setPinned(null) // 乐观取消
    try { if (target) await api.unpinMessage(target); void load() }
    catch (e) { toast(chatErrorText(e, t, t('操作失败', 'Failed')), 'error'); void load() }
  }

  return (
    <div className="flex w-full flex-col rounded-2xl surface border border-[var(--line)]">
      {/* 新消息读屏播报：隐藏 aria-live 区，会话进行中收到对端消息时播报"对端名：内容"。 */}
      <div aria-live="polite" aria-atomic="true" className="sr-only">{announce}</div>
      <header className="flex items-center gap-3 border-b border-[var(--line)] px-4 py-3">
        <button onClick={onBack} className="md:hidden" aria-label={t('返回', 'Back')}><IconX /></button>
        {sel.kind === 'peer' ? <Avatar name={sel.name} src={sel.avatar} size={36} /> : <span className="flex h-9 w-9 items-center justify-center rounded-full bg-honey/15 text-honey"><IconChat width={18} height={18} /></span>}
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold">{sel.name}</div>
          {/* 对端在线（WhatsApp 式会话头在线态）：正要说话的一刻分清"在线可期待秒回/该打电话"vs"离线只能留言"。读屏可闻。 */}
          {sel.kind === 'peer' && peerOnline && <div className="text-xs font-medium text-ok" role="status">{t('在线', 'Online')}</div>}
          {sel.kind === 'group' && <div className="text-xs text-faint">{joinNames(sel.members.map((m) => m.displayName), lang)}</div>}
        </div>
        <button onClick={() => { setSearchOpen((v) => !v); if (searchOpen) { setSearchQuery(''); setSearchResults(null) } }}
          className="rounded-full surface-2 px-3 py-1.5 text-xs font-medium text-soft" aria-label={t('搜索消息', 'Search messages')}>
          {searchOpen ? t('完成', 'Done') : t('搜索', 'Search')}
        </button>
        <button onClick={() => void toggleMute()} data-testid="mute-toggle" aria-pressed={muted}
          className="rounded-full surface-2 px-3 py-1.5 text-xs font-medium text-soft"
          aria-label={muted ? t('取消静音该会话', 'Unmute conversation') : t('静音该会话', 'Mute conversation')}>
          {muted ? t('🔕 已静音', '🔕 Muted') : t('静音', 'Mute')}
        </button>
        {sel.kind === 'peer' && (
          <button onClick={() => setReportOpen(true)} data-testid="report-open" className="rounded-full surface-2 px-3 py-1.5 text-xs font-medium text-faint hover:text-danger" aria-label={t('举报对方', 'Report')}>{t('举报', 'Report')}</button>
        )}
        {sel.kind === 'group' && (
          <button onClick={() => setShowInfo(true)} className="rounded-full surface-2 px-3 py-1.5 text-xs font-medium text-soft" aria-label={t('群信息', 'Group info')}>{t('群信息', 'Group info')}</button>
        )}
      </header>

      {searchOpen && (
        <div className="flex min-h-0 flex-1 flex-col border-b border-[var(--line)]">
          <div className="p-3">
            <input autoFocus value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)}
              placeholder={t('搜索这个会话的文字消息', 'Search text messages in this chat')}
              className="w-full rounded-full border border-[var(--line)] surface-2 px-4 py-2.5 text-sm outline-none focus:border-honey" />
          </div>
          <div tabIndex={0} aria-label={t('搜索结果', 'Search results')} className="flex-1 space-y-2 overflow-y-auto px-4 pb-4">
            {searchResults === null ? (
              <div className="grid h-full place-items-center text-sm text-faint">{t('输入关键词搜索本会话的文字消息', 'Type a keyword to search this chat')}</div>
            ) : searchResults.length === 0 ? (
              <div className="grid h-full place-items-center text-sm text-faint">{t('没有找到匹配的消息', 'No matching messages')}</div>
            ) : (
              <>
                {/* 诚实截断（no-silent-caps）：服务端只回最近 SEARCH_LIMIT 条；打满即可能还有更早的匹配，
                    绝不把截断说成"找到 N 条"冒充全量。 */}
                <div className="pt-1 text-xs text-faint">{searchResults.length >= SEARCH_LIMIT
                  ? t(`已显示最近 ${SEARCH_LIMIT} 条匹配，可能还有更早的`, `Showing the ${SEARCH_LIMIT} most recent matches — older ones may exist`)
                  : t(`找到 ${searchResults.length} 条`, `${searchResults.length} found`)}</div>
                {searchResults.map((m) => {
                  const who = m.fromId === user?.id ? t('我', 'Me')
                    : sel.kind === 'group' ? (sel.members.find((mm) => mm.id === m.fromId)?.displayName ?? '') : sel.name
                  // 文本式位置命中时显示 📍 地名而非原始 maps URL。
                  const loc = parseLocation(m.text)
                  // 每条命中都可点：搜索本就是为翻旧消息（命中多半不在当前已加载窗口）——点击关搜索、跳到该条并在
                  // 上下文里高亮；若更早未加载，jumpToMessage 会先回溯分页把它载进来再定位（IM 标配，见其实现）。
                  return (
                    <button key={m.id} type="button" data-testid="search-hit"
                      onClick={() => { setSearchOpen(false); setSearchQuery(''); setSearchResults(null); void jumpToMessage(m.id) }}
                      aria-label={t('跳到这条消息', 'Jump to this message')}
                      className="block w-full rounded-xl surface-2 px-3 py-2 text-left transition hover:brightness-105">
                      <div className="flex items-center justify-between text-[11px] text-faint">
                        <span className="font-semibold text-accent">{who}</span><span>{timeAgo(m.createdAt, lang)}</span>
                      </div>
                      <div className="mt-0.5 break-words text-sm">{loc ? `📍 ${loc.name || t('位置', 'Location')}` : m.text}</div>
                    </button>
                  )
                })}
              </>
            )}
          </div>
        </div>
      )}

      {/* 置顶消息横幅（Telegram 式）：钉在会话顶部；点跳到原消息（更早未加载则先回溯分页载入再定位，见 jumpToMessage）；X 取消置顶。 */}
      {pinned && !searchOpen && (
        <div className="flex items-center gap-2 border-b border-[var(--line)] bg-honey/5 px-4 py-2" data-testid="pinned-banner">
          <IconPin width={15} height={15} className="shrink-0 text-honey" />
          <button type="button" onClick={() => void jumpToMessage(pinned.id)} className="min-w-0 flex-1 text-left"
            aria-label={t(`置顶消息${pinned.pinnedByName ? `（${pinned.pinnedByName} 置顶）` : ''}：${preview(pinned, t)}，点击跳转`,
              `Pinned message${pinned.pinnedByName ? ` (by ${pinned.pinnedByName})` : ''}: ${preview(pinned, t)}, tap to jump`)}>
            <div className="text-[10px] font-semibold text-honey">{t('置顶', 'Pinned')}{pinned.pinnedByName ? ` · ${pinned.pinnedByName}` : ''}</div>
            <div className="truncate text-xs text-soft">{preview(pinned, t)}</div>
          </button>
          <button type="button" onClick={() => void unpin()} aria-label={t('取消置顶', 'Unpin')}
            className="shrink-0 rounded p-1 text-faint hover:text-danger"><IconX width={15} height={15} /></button>
        </div>
      )}

      <div ref={scrollRef} onScroll={onMsgScroll} tabIndex={0} aria-label={t('消息记录', 'Message history')}
        className={`flex-1 space-y-2 overflow-y-auto px-4 py-4 ${searchOpen ? 'hidden' : ''}`}>
        {jumping && ( // 跳转正在回溯加载更早历史（搜索/引用/置顶跳到很旧的消息）：给读屏与视觉一个进度反馈
          <div role="status" className="flex justify-center pb-1">
            <span className="rounded-full surface-2 px-3 py-1 text-xs text-soft">{t('定位到该消息…', 'Locating message…')}</span>
          </div>
        )}
        {canLoadEarlier && (
          <div className="flex justify-center pb-1">
            <button onClick={() => void loadEarlier()} disabled={loadingEarlier}
              className="rounded-full surface-2 px-3 py-1 text-xs text-soft disabled:opacity-50">
              {loadingEarlier ? t('加载中…', 'Loading…') : t('加载更早的消息', 'Load earlier messages')}
            </button>
          </div>
        )}
        {msgs === null ? <Spinner /> : msgs.length === 0 ? (
          <div className="grid h-full place-items-center text-sm text-faint">{t('开始你们的对话', 'Say hello')}</div>
        ) : msgs.map((m, i) => (
          <div key={m.id} id={`msg-${m.id}`} className={`rounded-xl transition-colors ${highlightId === m.id ? 'bg-honey/15' : ''}`}>
            {/* "新消息"分隔线（IM 标配）：打开会话时冻结在第一条未读对端消息前，一眼定位上次读到哪。role=separator 供读屏。 */}
            {firstUnreadId === m.id && (
              <div className="my-1 flex items-center gap-2 px-2" role="separator" aria-label={t(`${unreadAtOpen} 条新消息`, `${unreadAtOpen} new messages`)} data-testid="unread-divider">
                <span className="h-px flex-1 bg-honey/40" />
                <span className="shrink-0 text-[10px] font-medium text-honey">{t(`${unreadAtOpen} 条新消息`, `${unreadAtOpen} new`)}</span>
                <span className="h-px flex-1 bg-honey/40" />
              </div>
            )}
            {/* 日期分隔（IM 标配）：与上一条不同本地日则插"今天/昨天/日期"，跨天历史一眼分清；居中 role=separator 供读屏定位。 */}
            {needsDateSeparator(m.createdAt, i > 0 ? msgs[i - 1].createdAt : null) && (
              <div className="flex justify-center py-1.5" role="separator" aria-label={dateSeparatorLabel(m.createdAt, Date.now(), lang)}>
                <span className="rounded-full surface-2 px-2.5 py-0.5 text-[10px] text-faint">{dateSeparatorLabel(m.createdAt, Date.now(), lang)}</span>
              </div>
            )}
            <Bubble m={m} mine={m.fromId === user?.id} lang={lang} t={t} onRecall={() => recall(m)} onReact={(e) => react(m, e)} onEdit={(nt) => edit(m, nt)}
              onReply={() => setReplyingTo(m)} onForward={() => setForwarding(m)} onQuoteClick={jumpToMessage}
              onPin={() => (pinned?.id === m.id ? void unpin() : void pin(m))} pinnedHere={pinned?.id === m.id}
              repliedTo={m.replyTo ? msgs.find((x) => x.id === m.replyTo) : undefined}
              repliedName={(rid) => { const r = msgs.find((x) => x.id === rid); return r ? (r.fromId === user?.id ? t('你', 'You') : (sel.kind === 'group' ? (sel.members.find((mm) => mm.id === r.fromId)?.displayName ?? t('成员', 'Member')) : sel.name)) : '' }}
              isGroup={sel.kind === 'group'}
              senderName={sel.kind === 'group' && m.fromId !== user?.id ? (sel.members.find((mm) => mm.id === m.fromId)?.displayName ?? '') : undefined} />
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* 正在引用回复：composer 上方显示被引消息预览 + 取消。 */}
      {replyingTo && (
        <div className="flex items-center gap-2 border-t border-[var(--line)] bg-honey/5 px-3 py-2 text-xs" data-testid="reply-bar">
          <span className="shrink-0 font-semibold text-honey">↩ {t('回复', 'Reply')}{' '}
            {replyingTo.fromId === user?.id ? t('你', 'You') : (sel.kind === 'group' ? (sel.members.find((mm) => mm.id === replyingTo.fromId)?.displayName ?? t('成员', 'Member')) : sel.name)}</span>
          <span className="min-w-0 flex-1 truncate text-soft">{preview(replyingTo, t)}</span>
          <button onClick={() => setReplyingTo(null)} className="shrink-0 text-faint hover:text-danger" aria-label={t('取消回复', 'Cancel reply')}><IconX width={16} height={16} /></button>
        </div>
      )}
      <div className="flex items-center gap-2 border-t border-[var(--line)] p-3">
        <input ref={fileRef} type="file" accept="image/*,video/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) { void (f.type.startsWith('video/') ? sendVideo(f) : sendImage(f)) } e.target.value = '' }} />
        <button onClick={() => fileRef.current?.click()} disabled={sending} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full surface-2 text-soft disabled:opacity-40" aria-label={t('发送图片或视频', 'Send image or video')}><IconPlus /></button>
        <button onClick={sendLocation} disabled={sending} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full surface-2 text-soft disabled:opacity-40" aria-label={t('发送我的位置', 'Send my location')}><IconPin width={18} height={18} /></button>
        {/* 语音消息（盲人收件方的首选形态）：录 audio/mp4；浏览器不支持该格式时按钮自隐藏（能力门控，见组件）。 */}
        <VoiceRecorderButton disabled={sending} t={t} onSend={(dataUrl) => void sendAudio(dataUrl)} onError={(m) => toast(m, 'error')} />
        <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() } }}
          // 粘贴发图（WhatsApp Web/Slack 式）：剪贴板里是图片（截图/复制的图）→ 确认后直接发进会话，免存盘再点附件。
          // 只拦图片文件（imageFileFromClipboard 只认 image/* 文件项）：粘贴纯文本走默认输入，绝不受影响。
          // confirm 防误发（可能复制过图却想贴的是文字）；确认后走既有 sendImage（canvas 压缩 + EXIF 剥离同一条路）。
          onPaste={(e) => {
            const f = imageFileFromClipboard(e.clipboardData?.items)
            if (!f) return
            e.preventDefault()
            if (confirm(t('发送剪贴板中的图片？', 'Send the image from your clipboard?'))) void sendImage(f)
          }}
          maxLength={4000} /* 与后端 text≤4000 一致：超长在输入端即截，避免发出后才被服务端拒(message_too_long) */
          // aria-label 显式命名输入框：placeholder 在输入后消失、且并非所有读屏都稳定把它当可及名。
          aria-label={t('输入消息', 'Message')}
          placeholder={t('输入消息…', 'Type a message…')} className="min-w-0 flex-1 rounded-full border border-[var(--line)] surface-2 px-4 py-2.5 text-sm outline-none focus:border-honey" />
        <button onClick={send} disabled={!text.trim() || sending} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-honey text-ink disabled:opacity-40" aria-label={t('发送', 'Send')}><IconSend width={18} height={18} /></button>
      </div>

      {reportOpen && sel.kind === 'peer' && (
        <ReportDialog targetUserId={sel.id} onClose={() => setReportOpen(false)} />
      )}
      {showInfo && sel.kind === 'group' && (
        <GroupInfoDialog groupId={sel.id} groupName={sel.name} ownerId={sel.ownerId} members={sel.members} meId={user?.id ?? ''}
          onClose={() => setShowInfo(false)}
          onChanged={() => { onSent(); void load() }}
          onLeft={() => { setShowInfo(false); onSent(); onBack() }} />
      )}
      {forwarding && <ForwardDialog message={forwarding} onClose={() => setForwarding(null)} onSent={onSent} />}
    </div>
  )
}

/// 转发目标选择器：列出我的单聊会话 + 群，选中后把消息内容以 forwarded 标记重发过去。
/// 仅转发内容自包含的类型（文本/位置/图片）——视频是 mediaId，无权会话看不到，已在气泡处不给转发入口。
function ForwardDialog({ message, onClose, onSent }: { message: ChatMessage; onClose: () => void; onSent: () => void }) {
  const { t } = useI18n()
  const toast = useToast()
  const [convos, setConvos] = useState<Conversation[] | null>(null)
  const [groups, setGroups] = useState<GroupSummary[]>([])
  const [contacts, setContacts] = useState<FamilyLink[]>([]) // 已接受联系人：可转发给**尚无会话历史**的联系人（否则永远转不过去）
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void Promise.all([api.conversations(), api.groups(), api.familyLinks()])
      .then(([c, g, f]) => {
        setConvos(c.conversations); setGroups(g.groups)
        setContacts(f.links.filter((l) => (l.status ?? 'accepted') === 'accepted')) // 仅已接受（pending 不能收发）
      })
      .catch(() => setConvos([]))
  }, [])

  // 转发目标 = 最近会话 ∪ 已接受联系人（去重）∪ 群。此前只列"有过消息的会话"——第一次要把消息转给某位
  // 联系人时（还没聊过）该联系人根本不出现，转不过去。补上"还没会话历史的联系人"，与主流 IM 转发选人一致。
  const convoIds = new Set((convos ?? []).map((c) => c.peer.id))
  const extraContacts = contacts.filter((l) => !convoIds.has(l.memberId))

  // 目标一多时按名字过滤（与 Family 页联系人过滤同一模式/同一理由：免逐条滚/Tab 找人，读屏用户尤甚）。
  // 仅在目标 >6 时出搜索框，免小列表显无谓输入框。会话/联系人/群三源都参与过滤。
  const [q, setQ] = useState('')
  const query = q.trim().toLowerCase()
  const targetCount = (convos?.length ?? 0) + extraContacts.length + groups.length
  const showFilter = targetCount > 6
  const shownConvos = query ? (convos ?? []).filter((c) => (c.peer.displayName || '').toLowerCase().includes(query)) : (convos ?? [])
  const shownContacts = query ? extraContacts.filter((l) => l.memberName.toLowerCase().includes(query)) : extraContacts
  const shownGroups = query ? groups.filter((g) => g.group.name.toLowerCase().includes(query)) : groups

  const forwardTo = async (target: { toId?: string; groupId?: string }, name: string) => {
    if (busy) return
    setBusy(true)
    try {
      await api.sendMessage(target, message.kind, message.text, undefined, true)
      toast(t(`已转发给 ${name}`, `Forwarded to ${name}`), 'ok')
      onSent(); onClose()
    } catch (e) { toast(chatErrorText(e, t, t('转发失败', 'Forward failed')), 'error') }
    finally { setBusy(false) }
  }

  return (
    <Modal onClose={onClose} label={t('转发到', 'Forward to')} panelClassName="w-full max-w-sm">
      <h3 className="text-lg font-semibold">{t('转发到', 'Forward to')}</h3>
      <p className="mt-1 text-sm text-faint">{t('选择联系人或群聊', 'Choose a contact or group')}</p>
      {showFilter && (
        <div className="mt-3">
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)}
            placeholder={t('搜索联系人或群', 'Search contacts or groups')} aria-label={t('搜索转发目标', 'Search forward targets')}
            className="w-full rounded-xl surface-2 px-3 py-2 text-sm outline-none placeholder:text-faint focus:ring-2 focus:ring-[var(--color-honey)]/40" />
        </div>
      )}
      <div className="mt-3 max-h-[50vh] overflow-y-auto">
        {convos === null ? <Spinner /> : targetCount === 0 ? (
          <p className="py-6 text-center text-sm text-faint">{t('暂无可转发的联系人', 'No contacts to forward to')}</p>
        ) : (shownConvos.length + shownContacts.length + shownGroups.length) === 0 ? (
          <p className="py-6 text-center text-sm text-faint" role="status">{t('没有匹配的联系人', 'No matching contacts')}</p>
        ) : (
          <ul className="divide-y divide-[var(--line)]">
            {shownConvos.map((c) => {
              const pname = c.peer.displayName || t('已注销用户', 'Deactivated user') // 已注销对端本地化（同会话列表）
              return (
              <li key={`p:${c.peer.id}`}>
                <button disabled={busy} onClick={() => void forwardTo({ toId: c.peer.id }, pname)} data-testid="forward-target"
                  className="flex w-full items-center gap-3 px-1 py-2.5 text-left hover:surface-2 disabled:opacity-50">
                  <Avatar name={pname} src={c.peer.avatar} size={36} />
                  <span className="truncate text-sm font-medium">{pname}</span>
                </button>
              </li>
              )
            })}
            {/* 还没会话历史的联系人（转发给从未聊过的联系人）：与会话行同样可转发，仅数据源不同（familyLinks）。 */}
            {shownContacts.map((l) => (
              <li key={`c:${l.memberId}`}>
                <button disabled={busy} onClick={() => void forwardTo({ toId: l.memberId }, l.memberName)} data-testid="forward-target"
                  className="flex w-full items-center gap-3 px-1 py-2.5 text-left hover:surface-2 disabled:opacity-50">
                  <Avatar name={l.memberName} src={l.memberAvatar} size={36} />
                  <span className="truncate text-sm font-medium">{l.memberName}</span>
                  {l.relation ? <span className="ml-auto shrink-0 text-xs text-faint">{l.relation}</span> : null}
                </button>
              </li>
            ))}
            {shownGroups.map((g) => (
              <li key={`g:${g.group.id}`}>
                <button disabled={busy} onClick={() => void forwardTo({ groupId: g.group.id }, g.group.name)} data-testid="forward-target"
                  className="flex w-full items-center gap-3 px-1 py-2.5 text-left hover:surface-2 disabled:opacity-50">
                  <span className="flex h-9 w-9 items-center justify-center rounded-full bg-honey/15 text-honey"><IconChat width={18} height={18} /></span>
                  <span className="truncate text-sm font-medium">{g.group.name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="mt-4"><Button variant="soft" className="w-full" onClick={onClose}>{t('取消', 'Cancel')}</Button></div>
    </Modal>
  )
}

/// 群信息（与 iOS GroupInfoSheet 对齐）：成员列表 + 群主加人/踢人、成员退群、群主解散。
function GroupInfoDialog({ groupId, groupName, ownerId, members, meId, onClose, onChanged, onLeft }: {
  groupId: string; groupName: string; ownerId: string; members: User[]; meId: string
  onClose: () => void; onChanged: () => void; onLeft: () => void
}) {
  const { t } = useI18n()
  const toast = useToast()
  const isOwner = meId === ownerId
  const [list, setList] = useState<User[]>(members)
  const [contacts, setContacts] = useState<{ id: string; name: string }[]>([])
  const [busy, setBusy] = useState(false)
  const [name, setName] = useState(groupName) // 群主改名的编辑态

  // 拉最新成员（避免沿用进群时的旧快照）+ 可加联系人（我的 accepted 绑定中不在群里的）。
  const refresh = useCallback(async () => {
    try { const { groups } = await api.groups(); const g = groups.find((x) => x.group.id === groupId); if (g) setList(g.members) } catch { /* 保留现有 */ }
  }, [groupId])
  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => { void api.familyLinks().then(({ links }) => setContacts(links.filter((l) => (l.status ?? 'accepted') === 'accepted').map((l) => ({ id: l.memberId, name: l.memberName })))).catch(() => {}) }, [])

  const addable = contacts.filter((c) => !list.some((m) => m.id === c.id))

  const add = async (userId: string) => {
    setBusy(true)
    try { await api.addGroupMember(groupId, userId); await refresh(); onChanged() }
    catch (e) { toast(chatErrorText(e, t, t('操作失败', 'Failed')), 'error') } finally { setBusy(false) }
  }
  const kick = async (userId: string) => {
    setBusy(true)
    try { await api.leaveGroup(groupId, userId); await refresh(); onChanged() }
    catch (e) { toast(chatErrorText(e, t, t('操作失败', 'Failed')), 'error') } finally { setBusy(false) }
  }
  const leave = async () => {
    if (!confirm(t('退出后将不再收到此群消息，确定吗？', "You'll stop receiving this group's messages. Leave?"))) return
    setBusy(true)
    try { await api.leaveGroup(groupId, meId); onLeft() }
    catch (e) { toast(chatErrorText(e, t, t('操作失败', 'Failed')), 'error'); setBusy(false) }
  }
  const dissolve = async () => {
    if (!confirm(t('解散后所有群消息将被删除，确定吗？', 'Dissolving deletes all group messages. Are you sure?'))) return
    setBusy(true)
    try { await api.deleteGroup(groupId); onLeft() }
    catch (e) { toast(chatErrorText(e, t, t('操作失败', 'Failed')), 'error'); setBusy(false) }
  }
  // 群改名（群主）：新名非空且与原名不同才提交；成功后刷新父列表（标题下次选中即更新）。
  const rename = async () => {
    const n = name.trim()
    if (!n || n === groupName) return
    setBusy(true)
    try { await api.renameGroup(groupId, n); toast(t('群名已更改', 'Group renamed'), 'ok'); onChanged() }
    catch (e) { toast(chatErrorText(e, t, t('改名失败', 'Rename failed')), 'error') } finally { setBusy(false) }
  }

  return (
    <Modal onClose={onClose} label={groupName} panelClassName="flex max-h-[80vh] w-full max-w-sm flex-col">
        <h3 className="text-lg font-semibold">{groupName}</h3>
        {/* 群主改名（WhatsApp/Signal 标配）：内联编辑 + 保存；其余成员会收到 group_renamed 通知。 */}
        {isOwner && (
          <div className="mt-2 flex gap-2">
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={50} aria-label={t('群名', 'Group name')}
              className="min-w-0 flex-1 rounded-lg border border-[var(--line)] surface-2 px-3 py-1.5 text-sm outline-none focus:border-honey" />
            <Button variant="soft" onClick={rename} disabled={busy || !name.trim() || name.trim() === groupName}>{t('改名', 'Rename')}</Button>
          </div>
        )}
        <div className="mt-1 text-xs text-faint">{t('成员', 'Members')}（{list.length}）</div>
        <div className="mt-2 flex-1 overflow-y-auto rounded-xl border border-[var(--line)]">
          <ul className="divide-y divide-[var(--line)]">
            {list.map((m) => {
              // 已注销成员：服务端占位 username 为空（真实成员经 publicUser 恒有 username）→ 据此本地化，
              // 不漏服务端硬编码中文给英文用户（i18n 收口；仅群成员列表这一直观面，其余面见 chip）。
              const mname = m.username === '' ? t('已注销用户', 'Deactivated user') : m.displayName
              return (
              <li key={m.id} className="flex items-center gap-3 px-3 py-2.5">
                <Avatar name={mname} src={m.avatar} size={32} />
                <span className="flex min-w-0 flex-1 items-center gap-1.5 text-sm">
                  {/* 在线/待命圆点（读屏念"在线"）：盲人一眼看出群里此刻谁能即时接应求助。 */}
                  {m.online && <span role="img" aria-label={t('在线', 'Online')} title={t('在线', 'Online')} className="h-2 w-2 shrink-0 rounded-full bg-ok" />}
                  <span className="truncate">{mname}</span>
                  {m.id === ownerId && <span className="shrink-0 rounded-full bg-honey/20 px-2 py-0.5 text-[10px] text-accent">{t('群主', 'Owner')}</span>}
                </span>
                {isOwner && m.id !== ownerId && (
                  <button onClick={() => kick(m.id)} disabled={busy} className="text-xs text-danger hover:underline disabled:opacity-40">{t('移出', 'Remove')}</button>
                )}
              </li>
              )
            })}
          </ul>
        </div>
        {isOwner && addable.length > 0 && (
          <>
            <div className="mt-3 text-xs font-medium text-faint">{t('添加成员', 'Add member')}</div>
            <div className="mt-1 max-h-32 overflow-y-auto rounded-xl border border-[var(--line)]">
              <ul className="divide-y divide-[var(--line)]">
                {addable.map((c) => (
                  <li key={c.id} className="flex items-center gap-3 px-3 py-2">
                    <Avatar name={c.name} size={28} />
                    <span className="flex-1 truncate text-sm">{c.name}</span>
                    <button onClick={() => add(c.id)} disabled={busy} className="text-xs text-honey hover:underline disabled:opacity-40">{t('添加', 'Add')}</button>
                  </li>
                ))}
              </ul>
            </div>
          </>
        )}
        <div className="mt-4 flex gap-3">
          <button onClick={onClose} className="flex-1 rounded-xl surface-2 py-2.5 text-sm">{t('关闭', 'Close')}</button>
          {isOwner
            ? <button onClick={dissolve} disabled={busy} className="flex-1 rounded-xl bg-danger py-2.5 text-sm font-semibold text-white disabled:opacity-40">{t('解散群聊', 'Dissolve')}</button>
            : <button onClick={leave} disabled={busy} className="flex-1 rounded-xl bg-danger py-2.5 text-sm font-semibold text-white disabled:opacity-40">{t('退出群聊', 'Leave')}</button>}
        </div>
    </Modal>
  )
}

const REACTION_CHOICES = ['👍', '❤️', '😂', '😮', '😢', '🙏'] // 与 iOS ChatStrings.reactionChoices 对齐

function Bubble({ m, mine, lang, t, onRecall, onReact, onEdit, onReply, onForward, onPin, pinnedHere, onQuoteClick, repliedTo, repliedName, senderName, isGroup }: { m: ChatMessage; mine: boolean; lang: 'zh' | 'en'; t: (z: string, e: string) => string; onRecall: () => void; onReact: (emoji: string) => void; onEdit: (newText: string) => void; onReply: () => void; onForward: () => void; onPin?: () => void; pinnedHere?: boolean; onQuoteClick?: (id: string) => void; repliedTo?: ChatMessage; repliedName?: (id: string) => string; senderName?: string; isGroup?: boolean }) {
  const recallable = mine && m.kind !== 'recalled' && Date.now() - m.createdAt < 2 * 60_000
  const editable = mine && m.kind === 'text' && Date.now() - m.createdAt < 15 * 60_000
  const reactable = m.kind !== 'recalled'
  const replyable = m.kind !== 'recalled'
  // 可转发：仅**内容自包含**的类型（文本/位置/图片/语音都是内联内容）。视频是 mediaId、转发到无权会话看不到，
  // 撤回/未知亦不转发。判定抽到 isForwardableKind（含语音——它与图片同为 data: URL，此前被漏，见其单测）。
  const forwardable = isForwardableKind(m.kind)
  // 逐用户表情回应胶囊：优先服务端 reactions 数组（每 emoji 计数 + 我是否也回应）；旧服务端只回单字段 reaction
  // 时兜底合成一枚（mine 未知置 false）。myReaction=我当前所选（点选器高亮 + 切换判定用）。
  const reactionChips = m.reactions ?? (m.reaction ? [{ emoji: m.reaction, count: 1, mine: false, names: [] }] : [])
  const myReaction = reactionChips.find((r) => r.mine)?.emoji
  const [picking, setPicking] = useState(false)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(m.text)
  const saveEdit = () => { onEdit(draft); setEditing(false) }
  return (
    <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
      <div className={`group relative max-w-[78%] rounded-2xl px-3.5 py-2 text-sm ${mine ? 'bg-honey text-ink' : 'surface-2 text-[var(--text)]'} ${m.kind === 'recalled' ? 'italic opacity-60' : ''}`}>
        {/* 群聊里别人的消息署名——否则多人群聊分不清谁说的。 */}
        {senderName && <div className="mb-0.5 text-xs font-semibold text-honey">{senderName}</div>}
        {/* 「已转发」标注：防收件人误以为是发送者原创（WhatsApp 式）。 */}
        {m.forwarded && m.kind !== 'recalled' && <div data-testid="forwarded-tag" className={`mb-0.5 text-[10px] italic ${mine ? 'text-ink/55' : 'text-faint'}`}>↪ {t('已转发', 'Forwarded')}</div>}
        {/* 引用回复的原消息预览（WhatsApp 式）：已加载则显示"名字：内容"，未加载则显示占位。 */}
        {m.replyTo && (repliedTo && onQuoteClick
          ? <button type="button" data-testid="quoted" onClick={() => onQuoteClick(m.replyTo!)}
              aria-label={t('跳到被引用的消息', 'Jump to quoted message')}
              className={`mb-1 block w-full rounded-lg border-l-2 px-2 py-1 text-left text-xs transition hover:brightness-95 ${mine ? 'border-ink/40 bg-ink/5' : 'border-honey bg-honey/10'}`}>
              <span className="font-semibold">{repliedName?.(m.replyTo)}</span><span className="ml-1 opacity-80">{preview(repliedTo, t)}</span>
            </button>
          : <div data-testid="quoted" className={`mb-1 rounded-lg border-l-2 px-2 py-1 text-xs ${mine ? 'border-ink/40 bg-ink/5' : 'border-honey bg-honey/10'}`}>
              {/* 原消息未加载（更早、不在当前窗口）：占位不可点，避免点了跳空。 */}
              <span className="opacity-70">{t('引用的消息', 'Quoted message')}</span>
            </div>
        )}
        {editing ? (
          <div className="flex flex-col gap-1.5" data-testid="edit-box">
            <textarea value={draft} onChange={(e) => setDraft(e.target.value)} rows={2} maxLength={4000}
              aria-label={t('编辑消息', 'Edit message')}
              className="w-full resize-y rounded-lg border border-[var(--line)] bg-white/80 px-2 py-1 text-sm text-ink outline-none" />
            <div className="flex justify-end gap-2 text-xs">
              <button onClick={() => { setDraft(m.text); setEditing(false) }} className="hover:underline">{t('取消', 'Cancel')}</button>
              <button onClick={saveEdit} className="font-semibold hover:underline">{t('保存', 'Save')}</button>
            </div>
          </div>
        ) : <MessageBody m={m} t={t} />}
        <div className={`mt-1 flex items-center gap-2 text-[10px] ${mine ? 'text-ink/60' : 'text-faint'}`}>
          {/* 气泡显时刻(HH:MM)而非相对时间：日期由上方日期分隔归天，二者不冗余；title 悬停给完整日期时间（可及）。 */}
          <span title={fmtTime(m.createdAt, lang)}>{fmtHm(m.createdAt, lang)}</span>
          {m.editedAt && m.kind !== 'recalled' && <span data-testid="edited-tag">{t('已编辑', 'edited')}</span>}
          {editable && !editing && <button onClick={() => { setDraft(m.text); setEditing(true) }} className="opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 hover:underline">{t('编辑', 'Edit')}</button>}
          {replyable && !editing && <button onClick={onReply} className="opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 hover:underline">{t('回复', 'Reply')}</button>}
          {forwardable && !editing && <button onClick={onForward} className="opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 hover:underline">{t('转发', 'Forward')}</button>}
          {/* 置顶/取消置顶（每会话至多一条；撤回的不给入口）：把关键信息钉到顶部横幅。已是本会话置顶则显"取消置顶"。 */}
          {onPin && m.kind !== 'recalled' && !editing && <button onClick={onPin} className="opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 hover:underline">{pinnedHere ? t('取消置顶', 'Unpin') : t('置顶', 'Pin')}</button>}
          {/* 逐用户表情胶囊：每种 emoji 一枚，显数量（>1 才显）；我参与的高亮。点胶囊即切换本人的该表情（加/取消）。
              **谁回应了**：names 进 aria-label（读屏盲人听得到"小明、你 回应了👍"）+ title（悬停）——比只念"👍2"有用。 */}
          {reactionChips.map((r) => {
            const who = joinNames(r.names, lang) // 回应者名单（旧单字段兜底时为空 → 退回计数措辞）
            return (
            <button key={r.emoji} onClick={() => onReact(r.emoji)} data-testid="reaction-chip"
              title={who || undefined}
              aria-label={who
                ? t(`${r.emoji}，${who} 回应${r.mine ? '（含你）' : ''}，点击${r.mine ? '取消' : '也回应'}`,
                    `${r.emoji}, reacted by ${who}, tap to ${r.mine ? 'remove yours' : 'add yours'}`)
                : t(`${r.emoji}，${r.count} 人回应${r.mine ? '，含你' : ''}，点击${r.mine ? '取消' : '也回应'}`,
                    `${r.emoji}, ${r.count} ${r.count > 1 ? 'reactions' : 'reaction'}${r.mine ? ', including you' : ''}, tap to ${r.mine ? 'remove' : 'add'} yours`)}
              className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs leading-none transition ${r.mine ? 'bg-honey/25 font-semibold ring-1 ring-honey/40' : 'surface-2 hover:brightness-95'}`}>
              <span className="text-sm leading-none">{r.emoji}</span>{r.count > 1 && <span>{r.count}</span>}
            </button>
            )
          })}
          {reactable && (
            <button onClick={() => setPicking((v) => !v)} aria-label={t('表情回应', 'React')}
                    className="opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 hover:underline">{t('回应', 'React')}</button>
          )}
          {recallable && <button onClick={onRecall} className="opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 hover:underline">{t('撤回', 'Recall')}</button>}
          {/* 已读回执（与 iOS 对齐；仅自己发的单聊，撤回的不显示）：可见文字对读屏助手直接可读，无需图标 + aria-label。 */}
          {mine && m.kind !== 'recalled' && !isGroup && (
            <span className={m.readAt ? 'font-medium' : 'opacity-70'}>{m.readAt ? t('已读', 'Read') : t('已送达', 'Delivered')}</span>
          )}
          {/* 群已读回执：仅自己发的群消息、群里有其他成员时显示「已读 N/总」（后端只回计数，不暴露具体是谁）。 */}
          {mine && m.kind !== 'recalled' && isGroup && m.readTotal != null && m.readTotal > 0 && (
            <span data-testid="group-receipt" className={m.readBy === m.readTotal ? 'font-medium' : 'opacity-70'}>
              {t(`已读 ${m.readBy ?? 0}/${m.readTotal}`, `Read ${m.readBy ?? 0}/${m.readTotal}`)}</span>
          )}
        </div>
        {picking && (
          <div className="absolute -top-9 right-0 z-10 flex gap-1 rounded-full surface border border-[var(--line)] px-2 py-1 shadow-lg">
            {REACTION_CHOICES.map((e) => (
              <button key={e} onClick={() => { onReact(e); setPicking(false) }}
                      className={`text-lg leading-none transition hover:scale-125 ${myReaction === e ? 'opacity-100 scale-110' : 'opacity-80'}`}
                      aria-label={e}>{e}</button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

/// 图片消息：缩略图（≤64 高）+ 点击开全屏灯箱看大图——盲人分享的证件/单据/信件/标签照，协助者常要放大看清细节。
function ImageMessage({ src, t }: { src: string; t: (z: string, e: string) => string }) {
  const [zoomed, setZoomed] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const alt = t('图片消息', 'Photo')
  return (
    <>
      <button ref={triggerRef} type="button" onClick={() => setZoomed(true)} aria-label={t('放大查看图片', 'View photo full size')} className="block">
        <img src={src} alt={alt} className="max-h-64 rounded-lg" />
      </button>
      {/* 关闭时把焦点还给缩略图（proper 模态焦点归还，键盘/读屏用户不至于焦点丢到文档开头）。 */}
      {zoomed && <ImageLightbox src={src} alt={alt} onClose={() => { setZoomed(false); triggerRef.current?.focus() }} t={t} />}
    </>
  )
}

/// 图片灯箱（全屏查看）：暗底 + 居中大图（≤90vh/90vw）；点背景 / 关闭按钮 / Esc 关闭。role=dialog+aria-modal 供读屏。
/// 模态焦点：打开即把焦点移入关闭键；Tab 锁在灯箱内（唯一可聚焦=关闭键），焦点不逃到背后被 aria-modal 标记为 inert 的内容。
function ImageLightbox({ src, alt, onClose, t }: { src: string; alt: string; onClose: () => void; t: (z: string, e: string) => string }) {
  const closeRef = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    closeRef.current?.focus() // 打开即焦点入灯箱
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'Tab') { e.preventDefault(); closeRef.current?.focus() } // 焦点锁在关闭键，不逃出灯箱
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <div role="dialog" aria-modal="true" aria-label={alt} onClick={onClose} data-testid="image-lightbox"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4">
      <button ref={closeRef} type="button" onClick={onClose} aria-label={t('关闭', 'Close')}
        className="absolute right-4 top-4 rounded-full bg-white/10 p-2 text-white/90 hover:bg-white/20"><IconX width={20} height={20} /></button>
      {/* 点图片本身不关闭（stopPropagation），只点背景/关闭键关。 */}
      <img src={src} alt={alt} onClick={(e) => e.stopPropagation()} className="max-h-[90vh] max-w-[90vw] rounded-lg" />
    </div>
  )
}

function MessageBody({ m, t }: { m: ChatMessage; t: (z: string, e: string) => string }) {
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  const [videoFailed, setVideoFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    if (m.kind !== 'video' || !m.text) return
    let url: string | null = null
    let cancelled = false
    setVideoUrl(null); setVideoFailed(false) // 切换消息/重试时复位，避免沿用上一条状态
    void fetchMediaObjectURL(m.text)
      .then((u) => { if (cancelled) { URL.revokeObjectURL(u); return } url = u; setVideoUrl(u) })
      .catch(() => { if (!cancelled) setVideoFailed(true) }) // 失败要显式标记，否则与"加载中"无法区分、永久转圈
    return () => { cancelled = true; if (url) URL.revokeObjectURL(url) }
  }, [m.kind, m.text, attempt])

  if (m.kind === 'recalled') return <span>{t('该消息已撤回', 'Message recalled')}</span>
  if (m.kind === 'image') return <ImageMessage src={m.text} t={t} />
  // 无障碍：给音/视频加 aria-label（同 image 的 alt）——读屏否则只念"音频/视频播放器"，不知这是一条消息。
  if (m.kind === 'audio') return <audio src={m.text} controls aria-label={t('语音消息', 'Voice message')} className="max-w-[240px]" />
  if (m.kind === 'video') {
    if (videoUrl) return <video src={videoUrl} controls aria-label={t('视频消息', 'Video message')} className="max-h-64 rounded-lg" />
    if (videoFailed) return <button onClick={() => setAttempt((a) => a + 1)} className="underline opacity-80">{t('视频加载失败，点击重试', 'Video failed to load — tap to retry')}</button>
    return <span className="opacity-60">{t('[视频加载中]', '[Loading video]')}</span>
  }
  if (m.kind === 'location') {
    const loc = parseLocation(m.text)
    return loc ? <LocationLink loc={loc} t={t} /> : <span>📍 {t('位置', 'Location')}</span>
  }
  // 文本消息也可能是位置：iOS 默认把位置发成 kind=text + 内嵌 Apple Maps 链接（兼容未部署
  // location kind 的服务器）。识别出来渲染成位置，否则会显示成一串裸 URL。
  const loc = parseLocation(m.text)
  if (loc) return <LocationLink loc={loc} t={t} />
  // 纯文本：把其中的 http(s) 链接渲染成可点（对端发来的网址免复制粘贴）。只认 http/https、rel=noopener——
  // 其余仍是 React 转义的纯文本，无 XSS。见 linkify（已单测：危险 scheme/裸域名不当链接、引号处截断）。
  return (
    <span className="whitespace-pre-wrap break-words">
      {linkifyParts(m.text).map((p, i) => 'url' in p
        ? <a key={i} href={p.url} target="_blank" rel="noopener noreferrer" className="underline break-all">{p.url}</a>
        : <span key={i}>{p.text}</span>)}
    </span>
  )
}

/// 解析位置：兼容 JSON 形式（kind=location）与文本内嵌 Apple Maps 链接形式（iOS 默认）。
/// 地图链接一律 Apple Maps（项目约定，与紧急告警/Notifications/iOS 一致）：境内可打开，
/// 且在中国境内展示时自动做 WGS-84→GCJ 纠偏；OSM 境内时常不可达。
function LocationLink({ loc, t }: { loc: { lat: number; lng: number; name?: string }; t: (z: string, e: string) => string }) {
  return <a href={appleMapsUrl(loc.lat, loc.lng, loc.name)}
            target="_blank" rel="noreferrer" className="underline">📍 {loc.name || t('位置', 'Location')}</a>
}

function CreateGroupDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { t } = useI18n()
  const toast = useToast()
  const [name, setName] = useState('')
  const [contacts, setContacts] = useState<{ id: string; name: string }[]>([])
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)

  useEffect(() => { void api.familyLinks().then(({ links }) => setContacts(links.filter((l) => (l.status ?? 'accepted') === 'accepted').map((l) => ({ id: l.memberId, name: l.memberName })))).catch(() => {}) }, [])

  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })
  const submit = async () => {
    if (!name.trim() || picked.size === 0) return
    setBusy(true)
    try { await api.createGroup(name.trim(), [...picked]); toast(t('群已创建', 'Group created'), 'ok'); onCreated() }
    catch (e) { toast(chatErrorText(e, t, t('创建失败', 'Failed')), 'error') } finally { setBusy(false) }
  }
  return (
    <Modal onClose={onClose} label={t('创建群聊', 'New group')} panelClassName="flex max-h-[80vh] w-full max-w-sm flex-col">
        <h3 className="text-lg font-semibold">{t('创建群聊', 'New group')}</h3>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder={t('群名称', 'Group name')}
          className="mt-3 w-full rounded-xl border border-[var(--line)] surface-2 px-3.5 py-2.5 text-sm outline-none focus:border-honey" />
        <div className="mt-3 text-xs font-medium text-faint">{t('选择成员', 'Select members')}</div>
        <div className="mt-1 flex-1 overflow-y-auto rounded-xl border border-[var(--line)]">
          {contacts.length === 0 ? <div className="p-4 text-center text-sm text-faint">{t('暂无可选联系人', 'No contacts')}</div> : (
            <ul className="divide-y divide-[var(--line)]">
              {contacts.map((c) => (
                // 用 <label>+真复选框：点整行切换（label 原生行为），复选框天然可 Tab 聚焦 + 空格切换、
                // 被读屏播报为"姓名，复选框，已选/未选"。此前 onClick 挂 li + readOnly 复选框对键盘不可达。
                <li key={c.id}>
                  <label className="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:surface-2">
                    <Avatar name={c.name} size={32} />
                    <span className="flex-1 text-sm">{c.name}</span>
                    <input type="checkbox" checked={picked.has(c.id)} onChange={() => toggle(c.id)} className="accent-[var(--color-honey)]" />
                  </label>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="mt-4 flex gap-3">
          <button onClick={onClose} className="flex-1 rounded-xl surface-2 py-2.5 text-sm">{t('取消', 'Cancel')}</button>
          <button onClick={submit} disabled={busy || !name.trim() || picked.size === 0} className="flex-1 rounded-xl bg-honey py-2.5 text-sm font-semibold text-ink disabled:opacity-40">{t('创建', 'Create')}</button>
        </div>
    </Modal>
  )
}

// 图片压缩到 ≤ ~520KB 的 JPEG data URL（服务端限制 550KB；留余量）。
async function downscaleImage(file: File): Promise<string> {
  const img = document.createElement('img')
  const reader = new FileReader()
  const dataUrl = await new Promise<string>((res, rej) => { reader.onload = () => res(String(reader.result)); reader.onerror = rej; reader.readAsDataURL(file) })
  await new Promise<void>((res, rej) => { img.onload = () => res(); img.onerror = rej; img.src = dataUrl })
  const maxDim = 1280
  let { width, height } = img
  if (Math.max(width, height) > maxDim) { const s = maxDim / Math.max(width, height); width = Math.round(width * s); height = Math.round(height * s) }
  const canvas = document.createElement('canvas')
  canvas.width = width; canvas.height = height
  canvas.getContext('2d')!.drawImage(img, 0, 0, width, height)
  for (let q = 0.85; q >= 0.4; q -= 0.1) {
    const url = canvas.toDataURL('image/jpeg', q)
    if (url.length <= 520_000) return url
  }
  return canvas.toDataURL('image/jpeg', 0.4)
}
