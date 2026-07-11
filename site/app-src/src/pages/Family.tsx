import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, APIError, contentBlockedText, type FamilyLink, type IncomingLink, type SafetyTimer } from '../lib/api'
import { pollWhileVisible } from '../lib/poll'
import { hasUsableEmergencyContact } from '../lib/emergencyContacts'
import { emergencyDirection } from '../lib/emergencyRelation'
import { durationName } from '../lib/safetyCheckin'
import { classifyIdentifier } from '../lib/identifier'
import { useI18n } from '../lib/i18n'
import { useCall } from './call/CallController'
import { Card, Avatar, Button, Pill, Spinner, EmptyState, Field, Input, useToast, Modal } from '../components/ui'
import { IconUsers, IconPhone, IconChat, IconPlus, IconCheck, IconX, IconShield, IconFlash, IconFlag } from '../components/icons'
import { ReportDialog } from '../components/ReportDialog'
import { EmergencyReadinessCard } from '../components/EmergencyReadinessCard'
import { CheckinHistorySection } from '../components/CheckinHistorySection'
import { EmergencyContactPushWarning } from '../components/EmergencyContactPushWarning'
import { EmergencyHistorySection } from '../components/EmergencyHistorySection'
import { CheckinCountdown } from '../components/CheckinCountdown'

export function FamilyPage() {
  const { t } = useI18n()
  const toast = useToast()
  const nav = useNavigate()
  const { startOutgoing, active } = useCall()
  const [links, setLinks] = useState<FamilyLink[] | null>(null)
  const [incoming, setIncoming] = useState<IncomingLink[] | null>(null)
  const [blocks, setBlocks] = useState<{ id: string; user: { id: string; displayName: string; avatar?: string | null } }[] | null>(null)
  const [addOpen, setAddOpen] = useState(false)
  const [contactQuery, setContactQuery] = useState('') // 已绑定联系人按名字过滤（多时免逐条滚/Tab 找人；读屏尤甚）
  const [reportTarget, setReportTarget] = useState<FamilyLink | null>(null) // 举报对象（从联系人直接举报，无需通话中）

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
  // 紧急联系人徽标：按**方向**显示——「紧急联系人」=对方是我的；「你是 TA 的紧急联系人」=我对 TA 负责（TA 遇险叫我）。
  // 此前两向都笼统显示「紧急联系人」，让协助者误读安全责任方向（谁遇险时叫谁）。
  const emergencyBadge = (isEmergency: boolean | undefined, amOwner: boolean | undefined): string => {
    const dir = emergencyDirection(isEmergency, amOwner)
    if (dir === 'none') return ''
    return dir === 'iAmTheirs'
      ? ` · ${t('你是 TA 的紧急联系人', "You're their emergency contact")}`
      : ` · ${t('紧急联系人', 'Emergency contact')}`
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
  // 已绑定联系人按名字（不区分大小写）过滤：联系人一多，免逐条滚/Tab 找人（键入即缩到匹配项，对读屏用户尤其省事）。
  const contactQ = contactQuery.trim().toLowerCase()
  const shownAccepted = contactQ ? accepted.filter((l) => l.memberName.toLowerCase().includes(contactQ)) : accepted
  const pendingOut = (links ?? []).filter((l) => l.status === 'pending' && l.outgoing)
  // 我是几个人的紧急联系人（amOwner=false ∧ isEmergency ∧ 已接受）——TA 遇险/摔倒/未报到时会呼叫/告警我。
  // 责任提醒：协助者常不自知肩负多少人的安全网，须保持可联系（设备开着、App 能收推送）。
  const iAmEmergencyFor = accepted.filter((l) => l.amOwner === false && l.isEmergency).length

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">{t('联系人', 'Contacts')}</h1>
        <Button onClick={() => setAddOpen(true)}><IconPlus width={16} height={16} />{t('添加', 'Add')}</Button>
      </div>

      {/* 责任提醒：我是几个人的紧急联系人——TA 遇险时会呼叫/告警我，须保持可联系。role=status 读屏可闻。 */}
      {iAmEmergencyFor > 0 && (
        <div role="status" className="flex items-start gap-2 rounded-xl bg-honey/10 px-3 py-2.5 text-sm text-soft">
          <IconShield width={18} height={18} className="mt-0.5 shrink-0 text-accent" />
          <span>{t(`你是 ${iAmEmergencyFor} 位联系人的紧急联系人——TA 遇险时会呼叫你。请保持手机可联系、App 能收到通知。`,
                   `You're the emergency contact for ${iAmEmergencyFor} ${iAmEmergencyFor > 1 ? 'people' : 'person'} — they'll call you if they need help. Keep your phone reachable and notifications on.`)}</span>
        </div>
      )}

      {/* 真实核查（非只静态提醒）：我是紧急联系人却没开浏览器通知 → 主动警告并一键开启（自我版假安心防护）。 */}
      <EmergencyContactPushWarning emergencyFor={iAmEmergencyFor} />

      {/* 应急就绪自检：出事**前**先确认紧急联系人能否即时收到告警（防安全网其实不通的假安心）。 */}
      <EmergencyReadinessCard refreshKey={links} />

      {/* 安全报到（dead-man's switch）：出行前设时限，到点未报平安则自动告警紧急联系人。 */}
      <SafetyCheckInCard />

      {/* 本人紧急事件历史（过往 SOS/摔倒回看，折叠懒加载） */}
      <EmergencyHistorySection />

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
                  {/* 待确认请求：发起者恒为链 owner，故 amOwner=false → 若设了紧急即「你是 TA 的紧急联系人」（接受前就讲清责任方向）。 */}
                  <div className="text-xs text-faint">{l.relation}{emergencyBadge(l.isEmergency, false)}</div>
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
        {/* 联系人多时的搜索过滤（仅在有联系人时出现，避免对空列表显示无意义的搜索框）。 */}
        {accepted.length > 0 && (
          <div className="border-b border-[var(--line)] px-4 py-2.5">
            <input type="search" value={contactQuery} onChange={(e) => setContactQuery(e.target.value)}
              placeholder={t('搜索联系人', 'Search contacts')} aria-label={t('搜索联系人', 'Search contacts')}
              className="w-full rounded-xl surface-2 px-3 py-2 text-sm outline-none placeholder:text-faint focus:ring-2 focus:ring-[var(--color-honey)]/40" />
          </div>
        )}
        {links === null ? <Spinner /> : accepted.length === 0 ? (
          <EmptyState icon={<IconUsers />} title={t('暂无联系人', 'No contacts yet')} message={t('添加视障用户后即可为其提供协助', 'Add blind users to start helping them')} />
        ) : shownAccepted.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-faint" role="status">{t('没有匹配的联系人', 'No matching contacts')}</p>
        ) : (
          <ul className="divide-y divide-[var(--line)]">
            {shownAccepted.map((l) => (
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
                    <span className="text-faint">{l.relation}{emergencyBadge(l.isEmergency, l.amOwner)}</span>
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
                {/* 举报（信任与安全）：被骚扰不必非得在通话中才能举报——从联系人直接举报，服务端 /api/reports 无需 callId。 */}
                <button onClick={() => setReportTarget(l)} className="flex h-9 w-9 items-center justify-center rounded-full surface-2 text-faint hover:text-danger" aria-label={t('举报', 'Report')}><IconFlag width={16} height={16} /></button>
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
            {blocks.map((b) => {
              // 已注销对端：服务端发空 displayName（语言中立）→ 客户端本地化，不漏中文给英文用户。
              const blockedName = b.user.displayName || t('已注销用户', 'Deactivated user')
              return (
              <li key={b.id} className="flex items-center gap-3 px-4 py-3">
                <Avatar name={blockedName} src={b.user.avatar} size={36} />
                <div className="min-w-0 flex-1 truncate text-sm">{blockedName}</div>
                <Button variant="soft" onClick={() => unblock(b.id)}>{t('解除', 'Unblock')}</Button>
              </li>
              )
            })}
          </ul>
        </Card>
      )}

      {addOpen && <AddContactDialog onClose={() => setAddOpen(false)} onAdded={() => { setAddOpen(false); void reload() }} />}
      {reportTarget && (
        // 从联系人举报：仅需 targetUserId + 理由（无 callId/录制证据）；举报后可从行内「拉黑」按钮另行拉黑。
        <ReportDialog targetUserId={reportTarget.memberId} onClose={() => setReportTarget(null)} />
      )}
    </div>
  )
}

/// 安全报到卡（dead-man's switch）：空闲态选时长+备注开始；进行中显剩余 + 我平安了/延长/取消。与 iOS SafetyCheckInView 对齐。
function SafetyCheckInCard() {
  const { t, lang } = useI18n()
  const toast = useToast()
  const [timer, setTimer] = useState<SafetyTimer | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState('')
  const [duration, setDuration] = useState(60)
  // 到期告警实际发给**全体 accepted 联系人**（fireExpiredSafetyTimers），故"到点没报平安会不会有人被通知"
  // 须以 hasAnyContact 为准——只看紧急联系人会在"有联系人却没标紧急"时误报"无人会被通知"（与应急就绪同源修复）。
  const [hasAnyContact, setHasAnyContact] = useState(true) // 乐观默认 true，避免加载中闪现假警告
  const durations = [30, 60, 120, 240]

  // 轮询报到状态（与全站列表面一致）：到期告警发出、被别处（iOS/另一标签）报平安、每日定时报到自动开始，
  // 都会自动反映到卡片——尤其配 iter146 的实时倒计时：countdown 到 0 后，轮询把停滞的"active·0 分钟"刷成
  // 服务端真实态（已告警→回到空闲/历史）。cancelled 防卸载后 setState；前台可见才拉（pollWhileVisible）。
  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try { const r = await api.safetyCheckin(); if (!cancelled) { setTimer(r.timer); setHasAnyContact(r.hasAnyContact) } }
      catch { /* 未登录/网络：留空闲态 */ }
    }
    void load()
    const stop = pollWhileVisible(load, 20000)
    return () => { cancelled = true; stop() }
  }, [])

  const run = async (fn: () => Promise<SafetyTimer | null>, okMsg: string) => {
    setBusy(true)
    try { setTimer(await fn()); toast(okMsg, 'ok') }
    catch { toast(t('操作失败，请重试', 'Something went wrong — try again'), 'error') }
    finally { setBusy(false) }
  }
  // start 不走通用 run：需据服务端 hasEmergencyContact 决定是"成功"还是"防假安心"警告。
  const start = async () => {
    setBusy(true)
    try {
      const res = await api.startSafetyCheckin(duration, note.trim() || undefined)
      setTimer(res.timer); setHasAnyContact(res.hasAnyContact)
      if (res.hasAnyContact) {
        toast(t('安全报到已开始，到点前记得报平安', 'Check-in started — remember to mark yourself safe'), 'ok')
      } else {
        // 防假安心：到期告警扇给全体 accepted 联系人，一个联系人都没有才是真的"无人会被通知"。
        // 用 error 语气（toast 组件对 error 挂 role=alert，读屏即时朗读），明确告诉盲人这道安全网当前是空的。
        toast(t('已开始，但你还没有任何联系人——到点没报平安也无人会被通知。请先在下方添加联系人。',
                'Started, but you have no contacts yet — no one will be alerted if you miss it. Add a contact below first.'), 'error')
      }
    } catch { toast(t('操作失败，请重试', 'Something went wrong — try again'), 'error') }
    finally { setBusy(false) }
  }
  const complete = () => run(async () => { await api.completeSafetyCheckin(); return null }, t('已报平安，报到结束', "You're marked safe — check-in ended"))
  const extend = () => run(async () => (await api.extendSafetyCheckin(60)).timer, t('已延长 1 小时', 'Extended by 1 hour'))
  const cancel = () => run(async () => { await api.cancelSafetyCheckin(); return null }, t('已取消安全报到', 'Safety check-in canceled'))

  const active = timer?.status === 'active'
  return (
    <Card className="p-4">
      <h2 className="text-sm font-semibold">{t('安全报到', 'Safety check-in')}</h2>
      {active && timer ? (
        <div className="mt-2 space-y-3">
          {/* 进行中的持续预警（非只 start 一刻的 toast）：无任何联系人=到点没报平安也无人会被通知，重载/状态变化后仍在。 */}
          {!hasAnyContact && (
            <p role="alert" className="rounded-lg bg-danger/10 px-3 py-2 text-sm font-medium text-danger">
              {t('⚠️ 你还没有任何联系人——到点没报平安也无人会被通知。请在下方添加联系人。',
                 '⚠️ You have no contacts yet — no one will be alerted if you miss it. Add a contact below.')}
            </p>
          )}
          {/* 实时倒计时（每秒从 dueAt 递减）——此前只显服务端快照 remainingSec、卡片开着不动，是安全计时器的危险误导。 */}
          <CheckinCountdown dueAt={timer.dueAt} lang={lang} />
          {timer.note && <p className="text-sm text-faint">{timer.note}</p>}
          <div className="flex flex-wrap gap-2">
            <Button onClick={complete} disabled={busy}>{t("我平安了", "I'm safe")}</Button>
            <Button variant="soft" onClick={extend} disabled={busy}>{t('延长 1 小时', 'Extend 1h')}</Button>
            <Button variant="ghost" onClick={cancel} disabled={busy}>{t('取消报到', 'Cancel')}</Button>
          </div>
        </div>
      ) : (
        <div className="mt-2 space-y-3">
          <p className="text-sm text-faint">{t('独自出门前设一个时间。到点前点「我平安了」即可；若忘了或出意外没点，我们会自动把你的实时位置发给你的紧急联系人。', "Before heading out alone, set a timer. Tap “I'm safe” before it ends. If you forget or something happens and you don't, we automatically send your live location to your emergency contacts.")}</p>
          <div className="flex flex-wrap items-center gap-2">
            <label className="text-sm text-soft">{t('多久内报平安', 'Check in within')}</label>
            <select value={duration} onChange={(e) => setDuration(Number(e.target.value))} aria-label={t('报到时长', 'Check-in duration')}
              className="rounded-lg border border-[var(--line)] surface-2 px-2 py-1.5 text-sm">
              {durations.map((m) => <option key={m} value={m}>{durationName(m, lang)}</option>)}
            </select>
          </div>
          <Input value={note} onChange={(e) => setNote(e.target.value)} maxLength={200} aria-label={t('备注', 'Note')}
            placeholder={t('备注（可选，会念给亲友）：我去菜市场，2 小时没回就是出事了', 'Note (optional, read to your family): going to the market; if not back in 2h, something is wrong')} />
          <Button variant="danger" onClick={start} disabled={busy}>{t('开始报到', 'Start check-in')}</Button>
        </div>
      )}
      {/* 每日定时报到（Snug Safety 式）：独居者每天固定时刻自动开启一次报到——忘了设也有安全网。 */}
      <DailyScheduleSection />
      {/* 报到历史（本人回看，含已告警的那几次）：折叠式，独立组件。 */}
      <CheckinHistorySection />
    </Card>
  )
}

/// 每日定时报到配置区（SafetyCheckInCard 内）：每天固定本地时刻自动开启一次报到，超时未报平安自动告警
/// 紧急联系人。时区自动取浏览器 IANA 时区；HH:MM ↔ startMinute 换算在此层。
function DailyScheduleSection() {
  const { t, lang } = useI18n()
  const toast = useToast()
  const [enabled, setEnabled] = useState(false)
  const [time, setTime] = useState('09:00')
  const [dur, setDur] = useState(60)
  const [dnote, setDnote] = useState('')
  const [busy, setBusy] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const durations = [30, 60, 120, 240]
  useEffect(() => { void (async () => {
    try {
      const { schedule } = await api.checkinSchedule()
      if (schedule) {
        setEnabled(schedule.enabled)
        setTime(`${String(Math.floor(schedule.startMinute / 60)).padStart(2, '0')}:${String(schedule.startMinute % 60).padStart(2, '0')}`)
        setDur(schedule.durationMinutes); setDnote(schedule.note ?? '')
      }
    } catch { /* 网络失败留默认 */ }
    finally { setLoaded(true) }
  })() }, [])
  const tz = (() => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai' } catch { return 'Asia/Shanghai' } })()
  const save = async (nextEnabled: boolean) => {
    const [h, m] = time.split(':').map(Number)
    const startMinute = (Number.isFinite(h) ? h : 9) * 60 + (Number.isFinite(m) ? m : 0)
    setBusy(true)
    try {
      const r = await api.setCheckinSchedule({ enabled: nextEnabled, startMinute, durationMinutes: dur, tz, note: dnote.trim() || undefined })
      setEnabled(r.schedule.enabled)
      toast(nextEnabled
        ? (r.hasAnyContact
          ? t('每日报到已开启，每天到点会自动开始', 'Daily check-in on — starts automatically each day')
          : t('已开启，但你还没有任何联系人——超时也无人会被通知，请先添加联系人。', 'On, but you have no contacts yet — no one will be alerted. Add a contact first.'))
        : t('每日报到已关闭', 'Daily check-in off'), nextEnabled && !r.hasAnyContact ? 'error' : 'ok')
    } catch { toast(t('保存失败，请重试', 'Failed — try again'), 'error') }
    finally { setBusy(false) }
  }
  if (!loaded) return null
  return (
    <div className="mt-4 border-t border-[var(--line)] pt-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-semibold">{t('每日定时报到', 'Daily check-in')}</div>
          <p className="mt-0.5 text-xs text-faint">{t('每天到点自动开始一次报到，超时未报平安会自动通知紧急联系人（适合独居）。', 'Starts a check-in automatically each day; missing it alerts your emergency contacts (great for living alone).')}</p>
        </div>
        <button type="button" role="switch" aria-checked={enabled} disabled={busy} onClick={() => void save(!enabled)}
          aria-label={t('每日定时报到', 'Daily check-in')}
          className={`relative h-6 w-11 shrink-0 rounded-full transition ${enabled ? 'bg-honey' : 'bg-[var(--line)]'} disabled:opacity-50`}>
          <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${enabled ? 'left-[22px]' : 'left-0.5'}`} />
        </button>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <label className="text-sm text-soft" htmlFor="daily-time">{t('每天', 'Every day at')}</label>
        <input id="daily-time" type="time" value={time} onChange={(e) => setTime(e.target.value)}
          className="rounded-lg border border-[var(--line)] surface-2 px-2 py-1.5 text-sm" />
        <label className="text-sm text-soft">{t('时限', 'Window')}</label>
        <select value={dur} onChange={(e) => setDur(Number(e.target.value))} aria-label={t('每日报到时长', 'Daily check-in duration')}
          className="rounded-lg border border-[var(--line)] surface-2 px-2 py-1.5 text-sm">
          {durations.map((m) => <option key={m} value={m}>{durationName(m, lang)}</option>)}
        </select>
        {enabled && <Button variant="soft" onClick={() => void save(true)} disabled={busy}>{t('保存修改', 'Save')}</Button>}
      </div>
      {/* 备注（会随「到期提醒」与「错过报到」告警念给亲友，给他们判断险情的上下文）——与一次性报到的备注对等，
          此前每日报到独缺此输入：dnote 能从服务端载入回显、却无处编辑，网页用户设不了这条关键上下文。 */}
      <div className="mt-2">
        <Input value={dnote} onChange={(e) => setDnote(e.target.value)} maxLength={200} aria-label={t('每日报到备注', 'Daily check-in note')}
          placeholder={t('备注（可选，会念给亲友）：每天晨跑，没报平安可能出事', 'Note (optional, read to your family): daily morning jog; if I miss it, something may be wrong')} />
      </div>
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
