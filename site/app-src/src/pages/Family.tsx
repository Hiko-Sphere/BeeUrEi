import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, APIError, type FamilyLink, type IncomingLink } from '../lib/api'
import { classifyIdentifier } from '../lib/identifier'
import { useI18n } from '../lib/i18n'
import { useCall } from './call/CallController'
import { Card, Avatar, Button, Pill, Spinner, EmptyState, Field, Input, useToast } from '../components/ui'
import { IconUsers, IconPhone, IconChat, IconPlus, IconCheck, IconX, IconShield } from '../components/icons'

export function FamilyPage() {
  const { t } = useI18n()
  const toast = useToast()
  const nav = useNavigate()
  const { startOutgoing, active } = useCall()
  const [links, setLinks] = useState<FamilyLink[] | null>(null)
  const [incoming, setIncoming] = useState<IncomingLink[] | null>(null)
  const [blocks, setBlocks] = useState<{ id: string; user: { id: string; displayName: string; avatar?: string | null } }[] | null>(null)
  const [addOpen, setAddOpen] = useState(false)

  const reload = useCallback(async () => {
    const [l, i, b] = await Promise.allSettled([api.familyLinks(), api.incomingLinks(), api.blocks()])
    if (l.status === 'fulfilled') setLinks(l.value.links)
    if (i.status === 'fulfilled') setIncoming(i.value.links)
    if (b.status === 'fulfilled') setBlocks(b.value.blocks)
  }, [])

  useEffect(() => { void reload() }, [reload])

  const accept = async (id: string) => { try { await api.acceptLink(id); toast(t('已接受', 'Accepted'), 'ok'); void reload() } catch { toast(t('操作失败', 'Failed'), 'error') } }
  const remove = async (id: string) => { try { await api.deleteLink(id); void reload() } catch { toast(t('操作失败', 'Failed'), 'error') } }
  const unblock = async (id: string) => { try { await api.unblock(id); void reload() } catch { toast(t('操作失败', 'Failed'), 'error') } }
  // 拉黑联系人（不必正在通话也能拉黑：经聊天骚扰也可在此处理）：拉黑 + 解除绑定，之后互不可呼叫/发消息。
  const blockContact = async (link: FamilyLink) => {
    if (!confirm(t(`确定拉黑「${link.memberName}」？将解除绑定，对方无法再呼叫或给你发消息。`,
                   `Block "${link.memberName}"? This removes the link; they can no longer call or message you.`))) return
    try { await api.block(link.memberId); await api.deleteLink(link.id); toast(t('已拉黑', 'Blocked'), 'ok'); void reload() }
    catch { toast(t('操作失败', 'Failed'), 'error') }
  }

  const accepted = (links ?? []).filter((l) => (l.status ?? 'accepted') === 'accepted')
  const pendingOut = (links ?? []).filter((l) => l.status === 'pending' && l.outgoing)

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">{t('联系人', 'Contacts')}</h1>
        <Button onClick={() => setAddOpen(true)}><IconPlus width={16} height={16} />{t('添加', 'Add')}</Button>
      </div>

      {/* 待我确认的请求 */}
      {incoming && incoming.length > 0 && (
        <Card className="overflow-hidden">
          <div className="border-b border-[var(--line)] px-4 py-3 text-sm font-semibold">{t('待确认的请求', 'Pending requests')}</div>
          <ul className="divide-y divide-[var(--line)]">
            {incoming.map((l) => (
              <li key={l.id} className="flex items-center gap-3 px-4 py-3">
                <Avatar name={l.ownerName} src={l.ownerAvatar} size={40} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{l.ownerName}</div>
                  <div className="text-xs text-faint">{l.relation}{l.isEmergency ? ` · ${t('紧急联系人', 'Emergency')}` : ''}</div>
                </div>
                <button onClick={() => accept(l.id)} className="flex h-9 w-9 items-center justify-center rounded-full bg-ok text-white" aria-label={t('接受', 'Accept')}><IconCheck width={18} height={18} /></button>
                <button onClick={() => remove(l.id)} className="flex h-9 w-9 items-center justify-center rounded-full surface-2 text-danger" aria-label={t('拒绝', 'Reject')}><IconX width={18} height={18} /></button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* 已绑定联系人 */}
      <Card className="overflow-hidden">
        <div className="border-b border-[var(--line)] px-4 py-3 text-sm font-semibold">{t('我的联系人', 'My contacts')}</div>
        {links === null ? <Spinner /> : accepted.length === 0 ? (
          <EmptyState icon={<IconUsers />} title={t('暂无联系人', 'No contacts yet')} message={t('添加视障用户后即可为其提供协助', 'Add blind users to start helping them')} />
        ) : (
          <ul className="divide-y divide-[var(--line)]">
            {accepted.map((l) => (
              <li key={l.id} className="flex items-center gap-3 px-4 py-3">
                <Avatar name={l.memberName} src={l.memberAvatar} size={40} />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{l.memberName}</div>
                  <div className="text-xs text-faint">{l.relation}{l.isEmergency ? ` · ${t('紧急联系人', 'Emergency')}` : ''}</div>
                </div>
                <button onClick={() => startOutgoing(l.memberId, l.memberName, l.memberAvatar)} disabled={!!active}
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-honey/15 text-honey disabled:opacity-40" aria-label={t('呼叫', 'Call')}><IconPhone width={18} height={18} /></button>
                <button onClick={() => nav(`/chat/${l.memberId}`)} className="flex h-9 w-9 items-center justify-center rounded-full surface-2 text-soft" aria-label={t('消息', 'Message')}><IconChat width={18} height={18} /></button>
                <button onClick={() => blockContact(l)} className="flex h-9 w-9 items-center justify-center rounded-full surface-2 text-faint hover:text-danger" aria-label={t('拉黑', 'Block')}><IconShield width={16} height={16} /></button>
                <button onClick={() => remove(l.id)} className="flex h-9 w-9 items-center justify-center rounded-full surface-2 text-faint" aria-label={t('删除', 'Remove')}><IconX width={16} height={16} /></button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* 我发起、待对方确认 */}
      {pendingOut.length > 0 && (
        <Card className="overflow-hidden">
          <div className="border-b border-[var(--line)] px-4 py-3 text-sm font-semibold">{t('已发送的请求', 'Sent requests')}</div>
          <ul className="divide-y divide-[var(--line)]">
            {pendingOut.map((l) => (
              <li key={l.id} className="flex items-center gap-3 px-4 py-3">
                <Avatar name={l.memberName} src={l.memberAvatar} size={36} />
                <div className="min-w-0 flex-1"><div className="truncate text-sm font-medium">{l.memberName}</div><div className="text-xs text-faint">{t('等待对方确认', 'Awaiting confirmation')}</div></div>
                <Pill>{t('待确认', 'Pending')}</Pill>
                <button onClick={() => remove(l.id)} className="text-faint hover:text-danger" aria-label={t('撤销', 'Cancel')}><IconX width={16} height={16} /></button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* 黑名单 */}
      {blocks && blocks.length > 0 && (
        <Card className="overflow-hidden">
          <div className="border-b border-[var(--line)] px-4 py-3 text-sm font-semibold">{t('已拉黑', 'Blocked')}</div>
          <ul className="divide-y divide-[var(--line)]">
            {blocks.map((b) => (
              <li key={b.id} className="flex items-center gap-3 px-4 py-3">
                <Avatar name={b.user.displayName} src={b.user.avatar} size={36} />
                <div className="min-w-0 flex-1 truncate text-sm">{b.user.displayName}</div>
                <Button variant="soft" onClick={() => unblock(b.id)}>{t('解除', 'Unblock')}</Button>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {addOpen && <AddContactDialog onClose={() => setAddOpen(false)} onAdded={() => { setAddOpen(false); void reload() }} />}
    </div>
  )
}

function AddContactDialog({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const { t } = useI18n()
  const toast = useToast()
  const [q, setQ] = useState('')
  const [relation, setRelation] = useState('')
  const [emergency, setEmergency] = useState(false)
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    const query = q.trim()
    if (!query) return
    setBusy(true)
    try {
      // 邮箱/手机号先查 userId（与 iOS 一致：lookup → addLink by userId）；纯用户名可直接按 username 提交。
      // 标识符判定与登录共用 classifyIdentifier，两处口径一致（手机号按实际数字位判定）。
      let target: { username?: string; userId?: string }
      if (classifyIdentifier(query) !== 'username') {
        const r = await api.lookupUser(query)
        if (!r.user) { toast(t('未找到该用户', 'User not found'), 'error'); setBusy(false); return }
        target = { userId: r.user.id }
      } else {
        target = { username: query }
      }
      await api.addLink(target, relation.trim() || t('协助者', 'Helper'), emergency)
      toast(t('请求已发送', 'Request sent'), 'ok')
      onAdded()
    } catch (e) {
      const code = e instanceof APIError ? e.code : ''
      toast(code === 'already_linked' ? t('你们已是联系人', 'Already linked')
        : code === 'member_not_found' ? t('未找到该用户', 'User not found')
        : code === 'blocked' ? t('对方在黑名单中', 'Blocked relationship')
        : t('发送失败', 'Failed'), 'error')
    } finally { setBusy(false) }
  }

  return (
    <div className="fixed inset-0 z-[120] grid place-items-center bg-black/50 p-4" onClick={onClose}>
      <div className="slide-up w-full max-w-sm rounded-2xl surface border border-[var(--line)] p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="text-lg font-semibold">{t('添加联系人', 'Add contact')}</h3>
        <p className="mt-1 text-sm text-faint">{t('输入对方的用户名、邮箱或手机号', 'Enter their username, email, or phone')}</p>
        <div className="mt-4 flex flex-col gap-4">
          <Field label={t('用户名 / 邮箱 / 手机号', 'Username / Email / Phone')}>
            <Input value={q} onChange={(e) => setQ(e.target.value)} autoCapitalize="none" placeholder={t('例如 alice 或 alice@mail.com', 'e.g. alice or alice@mail.com')} />
          </Field>
          <Field label={t('关系称谓（可选）', 'Relation (optional)')}>
            <Input value={relation} onChange={(e) => setRelation(e.target.value)} placeholder={t('如：志愿者 / 子女', 'e.g. Volunteer / Child')} />
          </Field>
          <label className="flex items-center gap-2 text-sm text-soft">
            <input type="checkbox" checked={emergency} onChange={(e) => setEmergency(e.target.checked)} className="accent-[var(--color-honey)]" />
            {t('设为紧急联系人', 'Mark as emergency contact')}
          </label>
        </div>
        <div className="mt-5 flex gap-3">
          <Button variant="soft" className="flex-1" onClick={onClose}>{t('取消', 'Cancel')}</Button>
          <Button className="flex-1" loading={busy} onClick={submit} disabled={!q.trim()}>{t('发送请求', 'Send request')}</Button>
        </div>
      </div>
    </div>
  )
}
