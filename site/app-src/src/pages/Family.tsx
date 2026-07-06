import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, APIError, contentBlockedText, type FamilyLink, type IncomingLink } from '../lib/api'
import { hasUsableEmergencyContact } from '../lib/emergencyContacts'
import { classifyIdentifier } from '../lib/identifier'
import { useI18n } from '../lib/i18n'
import { useCall } from './call/CallController'
import { Card, Avatar, Button, Pill, Spinner, EmptyState, Field, Input, useToast, Modal } from '../components/ui'
import { IconUsers, IconPhone, IconChat, IconPlus, IconCheck, IconX, IconShield, IconFlash } from '../components/icons'

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
    // 失败时：有数据则保留，仍是初始 null 则落空数组退出加载态（避免某端点持续失败让该段永远转圈）。
    if (l.status === 'fulfilled') setLinks(l.value.links); else setLinks((c) => c ?? [])
    if (i.status === 'fulfilled') setIncoming(i.value.links); else setIncoming((c) => c ?? [])
    if (b.status === 'fulfilled') setBlocks(b.value.blocks); else setBlocks((c) => c ?? [])
  }, [])

  useEffect(() => { void reload() }, [reload])

  const accept = async (id: string) => { try { await api.acceptLink(id); toast(t('已接受', 'Accepted'), 'ok'); void reload() } catch { toast(t('操作失败', 'Failed'), 'error') } }
  // 底层「按 id 删链」：拒绝来请求 / 撤销去请求都复用它。okMsg 让各调用点给到贴切的成功确认（此前三处删链均静默成功）。
  const remove = async (id: string, okMsg?: string) => { try { await api.deleteLink(id); if (okMsg) toast(okMsg, 'ok'); void reload() } catch { toast(t('操作失败', 'Failed'), 'error') } }
  // 删除已绑定联系人：成功确认点名删了谁；删的是紧急联系人且删后已无可用紧急联系人时，追加安全提醒
  // （否则遇险无人可自动通知——静默假安心）。对齐 iOS FamilyLinksView.remove。从当前 links 同步扣掉本条来判定，
  // 不依赖 reload() 的异步 state（React setState 不即时可读）。警示用 error 语气（role=alert，读屏会即时朗读）。
  const removeContact = async (l: FamilyLink) => {
    try {
      await api.deleteLink(l.id)
      const noEmergencyLeft = l.isEmergency && !hasUsableEmergencyContact((links ?? []).filter((x) => x.id !== l.id))
      toast(noEmergencyLeft
        ? t(`已删除「${l.memberName}」。你现在没有紧急联系人了，遇险时将无人可自动通知。`, `Removed ${l.memberName}. You have no emergency contact now — no one will be alerted automatically in an emergency.`)
        : t(`已删除「${l.memberName}」`, `Removed ${l.memberName}`),
        noEmergencyLeft ? 'error' : 'ok')
      void reload()
    } catch { toast(t('操作失败', 'Failed'), 'error') }
  }
  // 切换某联系人是否为我的紧急联系人（紧急告警优先/升级/医疗信息可见都依赖此标志）。仅我作为 owner 的链可改。
  const toggleEmergency = async (l: FamilyLink) => {
    try { await api.setLinkEmergency(l.id, !l.isEmergency); toast(l.isEmergency ? t('已取消紧急联系人', 'Removed from emergency contacts') : t('已设为紧急联系人', 'Set as emergency contact'), 'ok'); void reload() }
    catch { toast(t('操作失败', 'Failed'), 'error') }
  }
  const unblock = async (id: string) => { try { await api.unblock(id); toast(t('已解除拉黑', 'Unblocked'), 'ok'); void reload() } catch { toast(t('操作失败', 'Failed'), 'error') } }
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
                <button onClick={() => remove(l.id, t('已拒绝', 'Rejected'))} className="flex h-9 w-9 items-center justify-center rounded-full surface-2 text-danger" aria-label={t('拒绝', 'Reject')}><IconX width={18} height={18} /></button>
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
                  <div className="text-xs">
                    {l.online && (
                      <span className="mr-1 inline-flex items-center gap-1 font-medium text-ok">
                        <span className="h-1.5 w-1.5 rounded-full bg-ok" aria-hidden="true" />{t('在线', 'Online')} ·{' '}
                      </span>
                    )}
                    <span className="text-faint">{l.relation}{l.isEmergency ? ` · ${t('紧急联系人', 'Emergency')}` : ''}</span>
                    {l.phone && /\d/.test(l.phone) && (
                      // 联系电话（tap-to-dial）：服务端一直下发 phone 却从未在 web 呈现（死字段）。是 App 内通话失败时
                      // 用普通电话兜底联系对方的安全退路（对齐 iOS EmergencyPhoneFallback 的 tel: 拨号）。
                      <span className="text-faint"> · <a href={`tel:${l.phone.replace(/[^\d+]/g, '')}`} onClick={(e) => e.stopPropagation()}
                        className="text-accent hover:underline" aria-label={t(`拨打电话 ${l.phone}`, `Call phone ${l.phone}`)}>{l.phone}</a></span>
                    )}
                  </div>
                </div>
                {l.amOwner && (
                  <button onClick={() => toggleEmergency(l)} aria-pressed={l.isEmergency}
                    className={`flex h-9 w-9 items-center justify-center rounded-full ${l.isEmergency ? 'bg-danger/15 text-danger' : 'surface-2 text-faint'}`}
                    title={l.isEmergency ? t('紧急联系人（点击取消）', 'Emergency contact (tap to remove)') : t('设为紧急联系人', 'Set as emergency contact')}
                    aria-label={l.isEmergency ? t('取消紧急联系人', 'Remove from emergency contacts') : t('设为紧急联系人', 'Set as emergency contact')}>
                    <IconFlash width={16} height={16} />
                  </button>
                )}
                <button onClick={() => startOutgoing(l.memberId, l.memberName, l.memberAvatar)} disabled={!!active}
                  className="flex h-9 w-9 items-center justify-center rounded-full bg-honey/15 text-honey disabled:opacity-40" aria-label={t('呼叫', 'Call')}><IconPhone width={18} height={18} /></button>
                <button onClick={() => nav(`/chat/${l.memberId}`)} className="flex h-9 w-9 items-center justify-center rounded-full surface-2 text-soft" aria-label={t('消息', 'Message')}><IconChat width={18} height={18} /></button>
                <button onClick={() => blockContact(l)} className="flex h-9 w-9 items-center justify-center rounded-full surface-2 text-faint hover:text-danger" aria-label={t('拉黑', 'Block')}><IconShield width={16} height={16} /></button>
                <button onClick={() => removeContact(l)} className="flex h-9 w-9 items-center justify-center rounded-full surface-2 text-faint" aria-label={t('删除', 'Remove')}><IconX width={16} height={16} /></button>
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
                <button onClick={() => remove(l.id, t('已撤销请求', 'Request canceled'))} className="text-faint hover:text-danger" aria-label={t('撤销', 'Cancel')}><IconX width={16} height={16} /></button>
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
      // 邮箱/手机号/纯数字用户名都先查 userId：lookupUser 走服务端 findByLoginIdentifier，**先按用户名**再手机号/邮箱，
      // 故连"幸运号 8888"这类纯数字用户名（≥5 位被 classifyIdentifier 判成 phone）也能在此按用户名查到，无需回退。
      // 纯字母/短用户名（classify=username）直接按 username 提交，addLink 服务端解析。两处口径共用 classifyIdentifier。
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
        : code === 'too_many_links' ? t('联系人数量已达上限', 'Contact limit reached')
        : code === 'cannot_link_self' ? t('不能添加自己', 'Cannot add yourself')
        : contentBlockedText(e, t, t('发送失败', 'Failed')), 'error')
    } finally { setBusy(false) }
  }

  return (
    <Modal onClose={onClose} label={t('添加联系人', 'Add contact')} panelClassName="w-full max-w-sm">
        <h3 className="text-lg font-semibold">{t('添加联系人', 'Add contact')}</h3>
        <p className="mt-1 text-sm text-faint">{t('输入对方的用户名、邮箱或手机号', 'Enter their username, email, or phone')}</p>
        <div className="mt-4 flex flex-col gap-4">
          <Field label={t('用户名 / 邮箱 / 手机号', 'Username / Email / Phone')}>
            <Input value={q} onChange={(e) => setQ(e.target.value)} autoCapitalize="none" placeholder={t('例如 alice 或 alice@mail.com', 'e.g. alice or alice@mail.com')} />
          </Field>
          <Field label={t('关系称谓（可选）', 'Relation (optional)')}>
            <Input value={relation} onChange={(e) => setRelation(e.target.value)} maxLength={32} placeholder={t('如：志愿者 / 子女', 'e.g. Volunteer / Child')} />
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
    </Modal>
  )
}
