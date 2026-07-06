import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { api, chatErrorText, fetchMediaObjectURL, uploadMedia, type ChatMessage, type Conversation, type GroupSummary, type User } from '../lib/api'
import { pollWhileVisible } from '../lib/poll'
import { useSession } from '../lib/session'
import { useI18n } from '../lib/i18n'
import { joinNames } from '../lib/listFormat'
import { parseLocation, appleMapsUrl } from '../lib/location'
import { isForwardableKind } from '../lib/chatMessage'
import { ReportDialog } from '../components/ReportDialog'
import { Avatar, Pill, Spinner, EmptyState, useToast, timeAgo, Modal, Button } from '../components/ui'
import { IconChat, IconSend, IconPlus, IconX } from '../components/icons'

type Selection = { kind: 'peer'; id: string; name: string; avatar?: string | null; muted?: boolean } | { kind: 'group'; id: string; name: string; members: User[]; ownerId: string; muted: boolean }

export function ChatPage() {
  const { peerId } = useParams()
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

  // 由路由 /chat/:peerId 预选单聊对象。**每个 peerId 只预选一次**：effect 依赖 convos（首帧 convos 为
  // null 时要等它到达才能解析对端名），但会话列表每 8s 轮询刷新一次——若不设一次性守卫，每次轮询都会把
  // 用户从其手动打开的另一会话强拉回 URL 里的 peer，丢掉草稿/滚动位置/已加载历史（复审 HIGH）。
  const appliedPeer = useRef<string | null>(null)
  useEffect(() => {
    if (!peerId) { appliedPeer.current = null; return } // 离开单聊路由：允许下次深链同一 peer 再预选
    if (appliedPeer.current === peerId) return           // 本 peerId 已预选过：后续 convos 轮询刷新不再抢回选择
    const c = convos?.find((x) => x.peer.id === peerId)
    if (c) { appliedPeer.current = peerId; setSel({ kind: 'peer', id: peerId, name: c.peer.displayName, avatar: c.peer.avatar, muted: c.muted ?? false }) }
    else void api.lookupUser(peerId).then((r) => { if (r.user) { appliedPeer.current = peerId; setSel({ kind: 'peer', id: peerId, name: r.user.displayName, avatar: r.user.avatar }) } }).catch(() => {
      void api.familyLinks().then(({ links }) => { const l = links.find((x) => x.memberId === peerId); if (l) { appliedPeer.current = peerId; setSel({ kind: 'peer', id: peerId, name: l.memberName, avatar: l.memberAvatar }) } })
    })
  }, [peerId, convos])

  const items = useMemo(() => {
    const a = (convos ?? []).map((c) => ({ key: `p:${c.peer.id}`, ts: c.last?.createdAt ?? 0, render: () => c, kind: 'peer' as const, c }))
    const b = (groups ?? []).map((g) => ({ key: `g:${g.group.id}`, ts: g.last?.createdAt ?? g.group.createdAt, kind: 'group' as const, g }))
    return [...a, ...b].sort((x, y) => y.ts - x.ts)
  }, [convos, groups])

  const back = () => { setSel(null); if (peerId) nav('/chat') }

  return (
    <div className="flex h-[calc(100dvh-7.5rem)] gap-4 md:h-[calc(100dvh-6rem)]">
      {/* 会话列表 */}
      <aside className={`w-full shrink-0 flex-col md:flex md:w-80 ${sel ? 'hidden md:flex' : 'flex'}`}>
        <div className="mb-3 flex items-center justify-between">
          <h1 className="text-xl font-bold tracking-tight">{t('消息', 'Messages')}</h1>
          <button onClick={() => setCreateOpen(true)} className="flex items-center gap-1 rounded-lg surface-2 px-2.5 py-1.5 text-xs font-medium text-soft hover:brightness-105"><IconPlus width={14} height={14} />{t('建群', 'New group')}</button>
        </div>
        <div tabIndex={0} aria-label={t('会话列表', 'Conversation list')}
          className="surface flex-1 overflow-y-auto rounded-2xl border border-[var(--line)]">
          {convos === null && groups === null ? <Spinner /> : items.length === 0 ? (
            <EmptyState icon={<IconChat />} title={t('暂无会话', 'No conversations')} message={t('从联系人页发起聊天', 'Start from Contacts')} />
          ) : (
            <ul className="divide-y divide-[var(--line)]">
              {items.map((it) => it.kind === 'peer' ? (
                <ConvoRow key={it.key} active={sel?.kind === 'peer' && sel.id === it.c.peer.id} convo={it.c} lang={lang} t={t}
                  onClick={() => setSel({ kind: 'peer', id: it.c.peer.id, name: it.c.peer.displayName, avatar: it.c.peer.avatar, muted: it.c.muted ?? false })} />
              ) : (
                <GroupRow key={it.key} active={sel?.kind === 'group' && sel.id === it.g.group.id} g={it.g} lang={lang} t={t}
                  onClick={() => setSel({ kind: 'group', id: it.g.group.id, name: it.g.group.name, members: it.g.members, ownerId: it.g.group.ownerId, muted: it.g.muted ?? false })} />
              ))}
            </ul>
          )}
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

function ConvoRow({ convo, active, onClick, lang, t }: { convo: Conversation; active: boolean; onClick: () => void; lang: 'zh' | 'en'; t: (z: string, e: string) => string }) {
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
          <div className="truncate text-xs text-faint">{preview(convo.last, t)}</div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className="text-[10px] text-faint">{convo.last ? timeAgo(convo.last.createdAt, lang) : ''}</span>
          {convo.unread > 0 && <span className="rounded-full bg-honey px-1.5 text-[10px] font-bold text-ink">{convo.unread}</span>}
        </div>
      </button>
    </li>
  )
}
function GroupRow({ g, active, onClick, lang, t }: { g: GroupSummary; active: boolean; onClick: () => void; lang: 'zh' | 'en'; t: (z: string, e: string) => string }) {
  return (
    <li className={active ? 'surface-2' : ''}>
      <button type="button" onClick={onClick} className="flex w-full items-center gap-3 px-3 py-3 text-left transition hover:surface-2">
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-honey/15 text-honey"><IconChat /></span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5"><span className="truncate font-medium">{g.group.name}</span><Pill>{g.members.length}</Pill>
            {g.muted && <span role="img" aria-label={t('已静音', 'Muted')} title={t('已静音', 'Muted')} className="shrink-0 text-xs text-faint">🔕</span>}</div>
          <div className="truncate text-xs text-faint">{preview(g.last, t)}</div>
        </div>
        <div className="flex flex-col items-end gap-1">
          <span className="text-[10px] text-faint">{g.last ? timeAgo(g.last.createdAt, lang) : ''}</span>
          {g.unread > 0 && <span className="rounded-full bg-honey px-1.5 text-[10px] font-bold text-ink">{g.unread}</span>}
        </div>
      </button>
    </li>
  )
}

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

function Thread({ sel, onBack, onSent, peerOnline }: { sel: Selection; onBack: () => void; onSent: () => void; peerOnline?: boolean }) {
  const { user } = useSession()
  const { t, lang } = useI18n()
  const toast = useToast()
  const [msgs, setMsgs] = useState<ChatMessage[] | null>(null)
  const [text, setText] = useState('')
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
  const fileRef = useRef<HTMLInputElement>(null)
  const PAGE = 50 // 与后端单次返回条数一致

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
      setMsgs((cur) => {
        const byId = new Map<string, ChatMessage>()
        for (const m of [...r.messages, ...(cur ?? [])]) byId.set(m.id, m)
        return [...byId.values()].sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
      })
      if (r.messages.length < PAGE) setReachedStart(true) // 不足一页 = 已到对话开头
    } catch { /* 失败下次再试 */ } finally { setLoadingEarlier(false) }
  }, [msgs, loadingEarlier, fetchWindow])

  useEffect(() => { void load(); return pollWhileVisible(load, 5000) }, [load])
  // 仅在**最新一条**变化时滚到底（新消息）；上翻加载更早消息时 last 不变，不应跳到底部。
  const lastId = msgs && msgs.length ? msgs[msgs.length - 1].id : null
  useEffect(() => { bottomRef.current?.scrollIntoView({ block: 'end' }) }, [lastId])
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

  const recall = async (m: ChatMessage) => {
    try { await api.recallMessage(m.id); await load() } catch (e) { toast(chatErrorText(e, t, t('撤回失败', 'Recall failed')), 'error') }
  }

  // 编辑自己的文字消息（限 15 分钟内）：改内容并标"已编辑"。
  const edit = async (m: ChatMessage, newText: string) => {
    const body = newText.trim()
    if (!body || body === m.text) return
    try { await api.editMessage(m.id, body); await load() } catch (e) { toast(chatErrorText(e, t, t('编辑失败', 'Edit failed')), 'error') }
  }

  // 表情回应（与 iOS 对齐）：再次点同一表情=取消（后端空串清除）。
  const react = async (m: ChatMessage, emoji: string) => {
    try { await api.reactMessage(m.id, m.reaction === emoji ? '' : emoji); await load() }
    catch (e) { toast(chatErrorText(e, t, t('操作失败', 'Failed')), 'error') }
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
                <div className="pt-1 text-xs text-faint">{t(`找到 ${searchResults.length} 条`, `${searchResults.length} found`)}</div>
                {searchResults.map((m) => {
                  const who = m.fromId === user?.id ? t('我', 'Me')
                    : sel.kind === 'group' ? (sel.members.find((mm) => mm.id === m.fromId)?.displayName ?? '') : sel.name
                  // 文本式位置命中时显示 📍 地名而非原始 maps URL。
                  const loc = parseLocation(m.text)
                  return (
                    <div key={m.id} className="rounded-xl surface-2 px-3 py-2">
                      <div className="flex items-center justify-between text-[11px] text-faint">
                        <span className="font-semibold text-accent">{who}</span><span>{timeAgo(m.createdAt, lang)}</span>
                      </div>
                      <div className="mt-0.5 break-words text-sm">{loc ? `📍 ${loc.name || t('位置', 'Location')}` : m.text}</div>
                    </div>
                  )
                })}
              </>
            )}
          </div>
        </div>
      )}

      <div tabIndex={0} aria-label={t('消息记录', 'Message history')}
        className={`flex-1 space-y-2 overflow-y-auto px-4 py-4 ${searchOpen ? 'hidden' : ''}`}>
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
        ) : msgs.map((m) => (
          <Bubble key={m.id} m={m} mine={m.fromId === user?.id} lang={lang} t={t} onRecall={() => recall(m)} onReact={(e) => react(m, e)} onEdit={(nt) => edit(m, nt)}
            onReply={() => setReplyingTo(m)} onForward={() => setForwarding(m)}
            repliedTo={m.replyTo ? msgs.find((x) => x.id === m.replyTo) : undefined}
            repliedName={(rid) => { const r = msgs.find((x) => x.id === rid); return r ? (r.fromId === user?.id ? t('你', 'You') : (sel.kind === 'group' ? (sel.members.find((mm) => mm.id === r.fromId)?.displayName ?? t('成员', 'Member')) : sel.name)) : '' }}
            isGroup={sel.kind === 'group'}
            senderName={sel.kind === 'group' && m.fromId !== user?.id ? (sel.members.find((mm) => mm.id === m.fromId)?.displayName ?? '') : undefined} />
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
        <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() } }}
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
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void Promise.all([api.conversations(), api.groups()])
      .then(([c, g]) => { setConvos(c.conversations); setGroups(g.groups) })
      .catch(() => setConvos([]))
  }, [])

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
      <p className="mt-1 text-sm text-faint">{t('选择一个会话', 'Choose a conversation')}</p>
      <div className="mt-3 max-h-[50vh] overflow-y-auto">
        {convos === null ? <Spinner /> : (convos.length === 0 && groups.length === 0) ? (
          <p className="py-6 text-center text-sm text-faint">{t('暂无可转发的会话', 'No conversations to forward to')}</p>
        ) : (
          <ul className="divide-y divide-[var(--line)]">
            {convos.map((c) => (
              <li key={`p:${c.peer.id}`}>
                <button disabled={busy} onClick={() => void forwardTo({ toId: c.peer.id }, c.peer.displayName)} data-testid="forward-target"
                  className="flex w-full items-center gap-3 px-1 py-2.5 text-left hover:surface-2 disabled:opacity-50">
                  <Avatar name={c.peer.displayName} src={c.peer.avatar} size={36} />
                  <span className="truncate text-sm font-medium">{c.peer.displayName}</span>
                </button>
              </li>
            ))}
            {groups.map((g) => (
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

  return (
    <Modal onClose={onClose} label={groupName} panelClassName="flex max-h-[80vh] w-full max-w-sm flex-col">
        <h3 className="text-lg font-semibold">{groupName}</h3>
        <div className="mt-1 text-xs text-faint">{t('成员', 'Members')}（{list.length}）</div>
        <div className="mt-2 flex-1 overflow-y-auto rounded-xl border border-[var(--line)]">
          <ul className="divide-y divide-[var(--line)]">
            {list.map((m) => (
              <li key={m.id} className="flex items-center gap-3 px-3 py-2.5">
                <Avatar name={m.displayName} src={m.avatar} size={32} />
                <span className="flex-1 truncate text-sm">{m.displayName}{m.id === ownerId && <span className="ml-2 rounded-full bg-honey/20 px-2 py-0.5 text-[10px] text-accent">{t('群主', 'Owner')}</span>}</span>
                {isOwner && m.id !== ownerId && (
                  <button onClick={() => kick(m.id)} disabled={busy} className="text-xs text-danger hover:underline disabled:opacity-40">{t('移出', 'Remove')}</button>
                )}
              </li>
            ))}
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

function Bubble({ m, mine, lang, t, onRecall, onReact, onEdit, onReply, onForward, repliedTo, repliedName, senderName, isGroup }: { m: ChatMessage; mine: boolean; lang: 'zh' | 'en'; t: (z: string, e: string) => string; onRecall: () => void; onReact: (emoji: string) => void; onEdit: (newText: string) => void; onReply: () => void; onForward: () => void; repliedTo?: ChatMessage; repliedName?: (id: string) => string; senderName?: string; isGroup?: boolean }) {
  const recallable = mine && m.kind !== 'recalled' && Date.now() - m.createdAt < 2 * 60_000
  const editable = mine && m.kind === 'text' && Date.now() - m.createdAt < 15 * 60_000
  const reactable = m.kind !== 'recalled'
  const replyable = m.kind !== 'recalled'
  // 可转发：仅**内容自包含**的类型（文本/位置/图片/语音都是内联内容）。视频是 mediaId、转发到无权会话看不到，
  // 撤回/未知亦不转发。判定抽到 isForwardableKind（含语音——它与图片同为 data: URL，此前被漏，见其单测）。
  const forwardable = isForwardableKind(m.kind)
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
        {m.replyTo && (
          <div data-testid="quoted" className={`mb-1 rounded-lg border-l-2 px-2 py-1 text-xs ${mine ? 'border-ink/40 bg-ink/5' : 'border-honey bg-honey/10'}`}>
            {repliedTo
              ? <><span className="font-semibold">{repliedName?.(m.replyTo)}</span><span className="ml-1 opacity-80">{preview(repliedTo, t)}</span></>
              : <span className="opacity-70">{t('引用的消息', 'Quoted message')}</span>}
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
          <span>{timeAgo(m.createdAt, lang)}</span>
          {m.editedAt && m.kind !== 'recalled' && <span data-testid="edited-tag">{t('已编辑', 'edited')}</span>}
          {editable && !editing && <button onClick={() => { setDraft(m.text); setEditing(true) }} className="opacity-0 transition group-hover:opacity-100 hover:underline">{t('编辑', 'Edit')}</button>}
          {replyable && !editing && <button onClick={onReply} className="opacity-0 transition group-hover:opacity-100 hover:underline">{t('回复', 'Reply')}</button>}
          {forwardable && !editing && <button onClick={onForward} className="opacity-0 transition group-hover:opacity-100 hover:underline">{t('转发', 'Forward')}</button>}
          {m.reaction && <span className="text-sm">{m.reaction}</span>}
          {reactable && (
            <button onClick={() => setPicking((v) => !v)} aria-label={t('表情回应', 'React')}
                    className="opacity-0 transition group-hover:opacity-100 hover:underline">{t('回应', 'React')}</button>
          )}
          {recallable && <button onClick={onRecall} className="opacity-0 transition group-hover:opacity-100 hover:underline">{t('撤回', 'Recall')}</button>}
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
                      className={`text-lg leading-none transition hover:scale-125 ${m.reaction === e ? 'opacity-100' : 'opacity-80'}`}
                      aria-label={e}>{e}</button>
            ))}
          </div>
        )}
      </div>
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
  if (m.kind === 'image') return <img src={m.text} alt={t('图片消息', 'Photo')} className="max-h-64 rounded-lg" />
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
  return <span className="whitespace-pre-wrap break-words">{m.text}</span>
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
