import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { api, chatErrorText, fetchMediaObjectURL, type ChatMessage, type Conversation, type GroupSummary, type User } from '../lib/api'
import { useSession } from '../lib/session'
import { useI18n } from '../lib/i18n'
import { Avatar, Pill, Spinner, EmptyState, useToast, timeAgo } from '../components/ui'
import { IconChat, IconSend, IconPlus, IconX } from '../components/icons'

type Selection = { kind: 'peer'; id: string; name: string; avatar?: string | null } | { kind: 'group'; id: string; name: string; members: User[] }

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
    if (c.status === 'fulfilled') setConvos(c.value.conversations)
    if (g.status === 'fulfilled') setGroups(g.value.groups)
  }, [])
  useEffect(() => { void loadLists(); const id = setInterval(loadLists, 8000); return () => clearInterval(id) }, [loadLists])

  // 由路由 /chat/:peerId 预选单聊对象。
  useEffect(() => {
    if (!peerId) return
    const c = convos?.find((x) => x.peer.id === peerId)
    if (c) setSel({ kind: 'peer', id: peerId, name: c.peer.displayName, avatar: c.peer.avatar })
    else void api.lookupUser(peerId).then((r) => { if (r.user) setSel({ kind: 'peer', id: peerId, name: r.user.displayName, avatar: r.user.avatar }) }).catch(() => {
      void api.familyLinks().then(({ links }) => { const l = links.find((x) => x.memberId === peerId); if (l) setSel({ kind: 'peer', id: peerId, name: l.memberName, avatar: l.memberAvatar }) })
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
        <div className="surface flex-1 overflow-y-auto rounded-2xl border border-[var(--line)]">
          {convos === null && groups === null ? <Spinner /> : items.length === 0 ? (
            <EmptyState icon={<IconChat />} title={t('暂无会话', 'No conversations')} message={t('从联系人页发起聊天', 'Start from Contacts')} />
          ) : (
            <ul className="divide-y divide-[var(--line)]">
              {items.map((it) => it.kind === 'peer' ? (
                <ConvoRow key={it.key} active={sel?.kind === 'peer' && sel.id === it.c.peer.id} convo={it.c} lang={lang} t={t}
                  onClick={() => setSel({ kind: 'peer', id: it.c.peer.id, name: it.c.peer.displayName, avatar: it.c.peer.avatar })} />
              ) : (
                <GroupRow key={it.key} active={sel?.kind === 'group' && sel.id === it.g.group.id} g={it.g} lang={lang} t={t}
                  onClick={() => setSel({ kind: 'group', id: it.g.group.id, name: it.g.group.name, members: it.g.members })} />
              ))}
            </ul>
          )}
        </div>
      </aside>

      {/* 对话窗格 */}
      <section className={`min-w-0 flex-1 ${sel ? 'flex' : 'hidden md:flex'}`}>
        {sel ? <Thread key={`${sel.kind}:${sel.id}`} sel={sel} onBack={back} onSent={loadLists} />
          : <div className="flex w-full items-center justify-center rounded-2xl surface border border-[var(--line)] text-faint">{t('选择一个会话开始聊天', 'Select a conversation')}</div>}
      </section>

      {createOpen && <CreateGroupDialog onClose={() => setCreateOpen(false)} onCreated={() => { setCreateOpen(false); void loadLists() }} />}
    </div>
  )
}

function ConvoRow({ convo, active, onClick, lang, t }: { convo: Conversation; active: boolean; onClick: () => void; lang: 'zh' | 'en'; t: (z: string, e: string) => string }) {
  return (
    <li onClick={onClick} className={`flex cursor-pointer items-center gap-3 px-3 py-3 transition hover:surface-2 ${active ? 'surface-2' : ''}`}>
      <Avatar name={convo.peer.displayName} src={convo.peer.avatar} size={44} />
      <div className="min-w-0 flex-1">
        <div className="truncate font-medium">{convo.peer.displayName}</div>
        <div className="truncate text-xs text-faint">{preview(convo.last, t)}</div>
      </div>
      <div className="flex flex-col items-end gap-1">
        <span className="text-[10px] text-faint">{convo.last ? timeAgo(convo.last.createdAt, lang) : ''}</span>
        {convo.unread > 0 && <span className="rounded-full bg-honey px-1.5 text-[10px] font-bold text-ink">{convo.unread}</span>}
      </div>
    </li>
  )
}
function GroupRow({ g, active, onClick, lang, t }: { g: GroupSummary; active: boolean; onClick: () => void; lang: 'zh' | 'en'; t: (z: string, e: string) => string }) {
  return (
    <li onClick={onClick} className={`flex cursor-pointer items-center gap-3 px-3 py-3 transition hover:surface-2 ${active ? 'surface-2' : ''}`}>
      <span className="flex h-11 w-11 items-center justify-center rounded-full bg-honey/15 text-honey"><IconChat /></span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5"><span className="truncate font-medium">{g.group.name}</span><Pill>{g.members.length}</Pill></div>
        <div className="truncate text-xs text-faint">{preview(g.last, t)}</div>
      </div>
      <div className="flex flex-col items-end gap-1">
        <span className="text-[10px] text-faint">{g.last ? timeAgo(g.last.createdAt, lang) : ''}</span>
        {g.unread > 0 && <span className="rounded-full bg-honey px-1.5 text-[10px] font-bold text-ink">{g.unread}</span>}
      </div>
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
    default: return m.text
  }
}

function Thread({ sel, onBack, onSent }: { sel: Selection; onBack: () => void; onSent: () => void }) {
  const { user } = useSession()
  const { t, lang } = useI18n()
  const toast = useToast()
  const [msgs, setMsgs] = useState<ChatMessage[] | null>(null)
  const [text, setText] = useState('')
  const [sending, setSending] = useState(false)
  const bottomRef = useRef<HTMLDivElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    try {
      const r = sel.kind === 'peer' ? await api.messagesWith(sel.id) : await api.groupMessages(sel.id)
      setMsgs(r.messages)
      if (sel.kind === 'peer') void api.markRead(sel.id).catch(() => {})
      else void api.markGroupRead(sel.id).catch(() => {})
    } catch { setMsgs([]) }
  }, [sel])
  useEffect(() => { void load(); const id = setInterval(load, 5000); return () => clearInterval(id) }, [load])
  useEffect(() => { bottomRef.current?.scrollIntoView({ block: 'end' }) }, [msgs])

  const target = sel.kind === 'peer' ? { toId: sel.id } : { groupId: sel.id }

  const send = async () => {
    const body = text.trim()
    if (!body || sending) return
    setSending(true)
    try { await api.sendMessage(target, 'text', body); setText(''); await load(); onSent() }
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

  const recall = async (m: ChatMessage) => {
    try { await api.recallMessage(m.id); await load() } catch { toast(t('撤回失败（超过 2 分钟？）', 'Recall failed'), 'error') }
  }

  return (
    <div className="flex w-full flex-col rounded-2xl surface border border-[var(--line)]">
      <header className="flex items-center gap-3 border-b border-[var(--line)] px-4 py-3">
        <button onClick={onBack} className="md:hidden" aria-label={t('返回', 'Back')}><IconX /></button>
        {sel.kind === 'peer' ? <Avatar name={sel.name} src={sel.avatar} size={36} /> : <span className="flex h-9 w-9 items-center justify-center rounded-full bg-honey/15 text-honey"><IconChat width={18} height={18} /></span>}
        <div className="min-w-0">
          <div className="truncate font-semibold">{sel.name}</div>
          {sel.kind === 'group' && <div className="text-xs text-faint">{sel.members.map((m) => m.displayName).join('、')}</div>}
        </div>
      </header>

      <div className="flex-1 space-y-2 overflow-y-auto px-4 py-4">
        {msgs === null ? <Spinner /> : msgs.length === 0 ? (
          <div className="grid h-full place-items-center text-sm text-faint">{t('开始你们的对话', 'Say hello')}</div>
        ) : msgs.map((m) => (
          <Bubble key={m.id} m={m} mine={m.fromId === user?.id} lang={lang} t={t} onRecall={() => recall(m)} />
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="flex items-center gap-2 border-t border-[var(--line)] p-3">
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void sendImage(f); e.target.value = '' }} />
        <button onClick={() => fileRef.current?.click()} disabled={sending} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full surface-2 text-soft disabled:opacity-40" aria-label={t('发送图片', 'Send image')}><IconPlus /></button>
        <input value={text} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send() } }}
          placeholder={t('输入消息…', 'Type a message…')} className="min-w-0 flex-1 rounded-full border border-[var(--line)] surface-2 px-4 py-2.5 text-sm outline-none focus:border-honey" />
        <button onClick={send} disabled={!text.trim() || sending} className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-honey text-ink disabled:opacity-40" aria-label={t('发送', 'Send')}><IconSend width={18} height={18} /></button>
      </div>
    </div>
  )
}

function Bubble({ m, mine, lang, t, onRecall }: { m: ChatMessage; mine: boolean; lang: 'zh' | 'en'; t: (z: string, e: string) => string; onRecall: () => void }) {
  const recallable = mine && m.kind !== 'recalled' && Date.now() - m.createdAt < 2 * 60_000
  return (
    <div className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
      <div className={`group max-w-[78%] rounded-2xl px-3.5 py-2 text-sm ${mine ? 'bg-honey text-ink' : 'surface-2 text-[var(--text)]'} ${m.kind === 'recalled' ? 'italic opacity-60' : ''}`}>
        <MessageBody m={m} t={t} />
        <div className={`mt-1 flex items-center gap-2 text-[10px] ${mine ? 'text-ink/60' : 'text-faint'}`}>
          <span>{timeAgo(m.createdAt, lang)}</span>
          {m.reaction && <span className="text-sm">{m.reaction}</span>}
          {recallable && <button onClick={onRecall} className="opacity-0 transition group-hover:opacity-100 hover:underline">{t('撤回', 'Recall')}</button>}
        </div>
      </div>
    </div>
  )
}

function MessageBody({ m, t }: { m: ChatMessage; t: (z: string, e: string) => string }) {
  const [videoUrl, setVideoUrl] = useState<string | null>(null)
  useEffect(() => {
    if (m.kind !== 'video' || !m.text) return
    let url: string | null = null
    void fetchMediaObjectURL(m.text).then((u) => { url = u; setVideoUrl(u) }).catch(() => {})
    return () => { if (url) URL.revokeObjectURL(url) }
  }, [m.kind, m.text])

  if (m.kind === 'recalled') return <span>{t('该消息已撤回', 'Message recalled')}</span>
  if (m.kind === 'image') return <img src={m.text} alt="" className="max-h-64 rounded-lg" />
  if (m.kind === 'audio') return <audio src={m.text} controls className="max-w-[240px]" />
  if (m.kind === 'video') return videoUrl ? <video src={videoUrl} controls className="max-h-64 rounded-lg" /> : <span className="opacity-60">{t('[视频加载中]', '[Loading video]')}</span>
  if (m.kind === 'location') {
    try {
      const loc = JSON.parse(m.text) as { lat: number; lng: number; name?: string }
      return <a href={`https://www.openstreetmap.org/?mlat=${loc.lat}&mlon=${loc.lng}#map=17/${loc.lat}/${loc.lng}`} target="_blank" rel="noreferrer" className="underline">📍 {loc.name || t('位置', 'Location')}</a>
    } catch { return <span>📍 {t('位置', 'Location')}</span> }
  }
  return <span className="whitespace-pre-wrap break-words">{m.text}</span>
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
    <div className="fixed inset-0 z-[120] grid place-items-center bg-black/50 p-4" onClick={onClose}>
      <div className="slide-up flex max-h-[80vh] w-full max-w-sm flex-col rounded-2xl surface border border-[var(--line)] p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold">{t('创建群聊', 'New group')}</h3>
        <input value={name} onChange={(e) => setName(e.target.value)} maxLength={40} placeholder={t('群名称', 'Group name')}
          className="mt-3 w-full rounded-xl border border-[var(--line)] surface-2 px-3.5 py-2.5 text-sm outline-none focus:border-honey" />
        <div className="mt-3 text-xs font-medium text-faint">{t('选择成员', 'Select members')}</div>
        <div className="mt-1 flex-1 overflow-y-auto rounded-xl border border-[var(--line)]">
          {contacts.length === 0 ? <div className="p-4 text-center text-sm text-faint">{t('暂无可选联系人', 'No contacts')}</div> : (
            <ul className="divide-y divide-[var(--line)]">
              {contacts.map((c) => (
                <li key={c.id} onClick={() => toggle(c.id)} className="flex cursor-pointer items-center gap-3 px-3 py-2.5 hover:surface-2">
                  <Avatar name={c.name} size={32} />
                  <span className="flex-1 text-sm">{c.name}</span>
                  <input type="checkbox" readOnly checked={picked.has(c.id)} className="accent-[var(--color-honey)]" />
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="mt-4 flex gap-3">
          <button onClick={onClose} className="flex-1 rounded-xl surface-2 py-2.5 text-sm">{t('取消', 'Cancel')}</button>
          <button onClick={submit} disabled={busy || !name.trim() || picked.size === 0} className="flex-1 rounded-xl bg-honey py-2.5 text-sm font-semibold text-ink disabled:opacity-40">{t('创建', 'Create')}</button>
        </div>
      </div>
    </div>
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
