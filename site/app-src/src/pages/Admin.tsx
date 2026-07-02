import { useCallback, useEffect, useState } from 'react'
import { api, type AdminOverview, type AdminActiveCall, type AdminReport, type AdminUser } from '../lib/api'
import { apiURL } from '../lib/config'
import { useI18n } from '../lib/i18n'
import { roleLabel } from '../components/Layout'
import { Card, Avatar, Button, Pill, Spinner, EmptyState, Input, useToast, fmtTime, fmtDuration, Modal } from '../components/ui'
import { IconShield, IconPhone, IconFlag, IconUsers, IconX } from '../components/icons'

type Tab = 'overview' | 'live' | 'reports' | 'users'

export function AdminPage() {
  const { t } = useI18n()
  const [tab, setTab] = useState<Tab>('overview')
  const tabs: { id: Tab; label: string; icon: React.ReactNode }[] = [
    { id: 'overview', label: t('总览', 'Overview'), icon: <IconShield /> },
    { id: 'live', label: t('实时通话', 'Live calls'), icon: <IconPhone /> },
    { id: 'reports', label: t('举报', 'Reports'), icon: <IconFlag /> },
    { id: 'users', label: t('用户', 'Users'), icon: <IconUsers /> },
  ]
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold tracking-tight">{t('管理后台', 'Admin')}</h1>
        <a href={apiURL('/admin')} target="_blank" rel="noreferrer" className="text-sm font-medium text-honey hover:underline">{t('打开完整控制台 ↗', 'Full console ↗')}</a>
      </div>
      <div className="flex gap-1 overflow-x-auto rounded-xl surface-2 p-1">
        {tabs.map((x) => (
          <button key={x.id} onClick={() => setTab(x.id)} className={`flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition ${tab === x.id ? 'surface shadow-sm' : 'text-faint'}`}>
            {x.icon}{x.label}
          </button>
        ))}
      </div>
      {tab === 'overview' && <OverviewTab />}
      {tab === 'live' && <LiveTab />}
      {tab === 'reports' && <ReportsTab />}
      {tab === 'users' && <UsersTab />}
    </div>
  )
}

function OverviewTab() {
  const { t } = useI18n()
  const [ov, setOv] = useState<AdminOverview | null>(null)
  useEffect(() => { let a = true; const f = () => void api.adminOverview().then((o) => a && setOv(o)).catch(() => {}); f(); const id = setInterval(f, 15_000); return () => { a = false; clearInterval(id) } }, [])
  if (!ov) return <Spinner />
  const stat = [
    { label: t('用户总数', 'Total users'), value: ov.users.total, sub: `${ov.users.active} ${t('活跃', 'active')} · ${ov.users.disabled} ${t('停用', 'disabled')}` },
    { label: t('在线协助者', 'Online helpers'), value: ov.online.helpers, sub: `${ov.online.total} ${t('在线', 'online')}` },
    { label: t('待处理举报', 'Open reports'), value: ov.reports.open, sub: `${ov.reports.total} ${t('累计', 'total')}` },
    { label: t('录制总数', 'Recordings'), value: ov.recordings.total, sub: ov.recordings.config.enabled ? t('录制已开启', 'recording on') : t('录制已关闭', 'recording off') },
    { label: t('近7天新增', 'New (7d)'), value: ov.growth.newUsers7d, sub: `${ov.growth.newUsers30d} ${t('近30天', 'in 30d')}` },
  ]
  const maxTrend = Math.max(1, ...ov.growth.trend.map((d) => d.count))
  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {stat.map((s) => (
          <Card key={s.label} className="p-4"><div className="text-xs text-faint">{s.label}</div><div className="mt-1 text-2xl font-bold">{s.value}</div><div className="mt-0.5 text-[11px] text-faint">{s.sub}</div></Card>
        ))}
      </div>
      <Card className="p-5">
        <div className="mb-3 text-sm font-semibold">{t('近 30 天注册趋势', 'Sign-ups (30 days)')}</div>
        <div className="flex h-28 items-end gap-1">
          {ov.growth.trend.map((d) => (
            <div key={d.date} className="flex-1 rounded-sm bg-honey/70" style={{ height: `${(d.count / maxTrend) * 100}%`, minHeight: d.count ? 3 : 1 }} title={`${d.date}: ${d.count}`} />
          ))}
        </div>
      </Card>
      <Card className="p-5">
        <div className="mb-3 text-sm font-semibold">{t('角色分布', 'By role')}</div>
        <div className="flex flex-wrap gap-2">
          {Object.entries(ov.users.byRole).map(([r, n]) => <Pill key={r} tone="soft">{roleLabel(r, t)}：{n}</Pill>)}
        </div>
        <div className="mt-4 text-xs text-faint">{t('服务端版本', 'Server')} {ov.version} · {t('运行', 'uptime')} {fmtDuration(ov.uptimeSeconds)}</div>
      </Card>
    </div>
  )
}

function LiveTab() {
  const { t } = useI18n()
  const toast = useToast()
  const [calls, setCalls] = useState<AdminActiveCall[] | null>(null)
  const load = useCallback(() => void api.adminActiveCalls().then((r) => setCalls(r.calls)).catch(() => setCalls([])), [])
  useEffect(() => { load(); const id = setInterval(load, 4000); return () => clearInterval(id) }, [load])
  const end = async (callId: string) => {
    if (!confirm(t('强制结束这通通话？双方会立即收线。', 'Force-end this call? Both parties disconnect.'))) return
    try { await api.adminEndCall(callId); toast(t('已结束', 'Ended'), 'ok'); load() } catch { toast(t('结束失败（可能已结束）', 'Failed (already ended?)'), 'error') }
  }
  if (calls === null) return <Spinner />
  if (calls.length === 0) return <Card><EmptyState icon={<IconPhone />} title={t('当前没有进行中的通话', 'No active calls')} /></Card>
  return (
    <div className="flex flex-col gap-3">
      {calls.map((c) => (
        <Card key={c.callId} className="p-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-sm">
              <span className="inline-block h-2 w-2 rounded-full bg-ok ring-live" />
              <span className="font-medium">{fmtDuration(c.durationSec)}</span>
              {c.hasAdminObserver && <Pill tone="honey">{t('监看中', 'Observed')}</Pill>}
            </div>
            <Button variant="danger" onClick={() => end(c.callId)}><IconX width={15} height={15} />{t('强制结束', 'Force end')}</Button>
          </div>
          <div className="mt-3 flex flex-wrap gap-3">
            {c.members.map((m) => (
              <div key={m.userId} className="flex items-center gap-2 rounded-xl surface-2 px-3 py-2">
                <Avatar name={m.name} size={28} />
                <div className="text-sm"><div className="font-medium">{m.name}</div><div className="text-[11px] text-faint">{roleLabel(m.role, t)}</div></div>
              </div>
            ))}
          </div>
          <a href={apiURL('/admin')} target="_blank" rel="noreferrer" className="mt-3 inline-block text-xs text-honey hover:underline">{t('在完整控制台旁观音视频 ↗', 'Observe A/V in full console ↗')}</a>
        </Card>
      ))}
    </div>
  )
}

function ReportsTab() {
  const { t } = useI18n()
  const toast = useToast()
  const [reports, setReports] = useState<AdminReport[] | null>(null)
  const [active, setActive] = useState<AdminReport | null>(null)
  const load = useCallback(() => void api.adminReports().then((r) => setReports(r.reports)).catch(() => setReports([])), [])
  useEffect(() => { load() }, [load])
  const open = (reports ?? []).filter((r) => r.status !== 'resolved')
  const done = (reports ?? []).filter((r) => r.status === 'resolved')

  const moderate = async (id: string, action: 'dismiss' | 'warn' | 'suspend' | 'ban', reason: string) => {
    try { await api.adminModerate(id, action, reason); toast(t('已处置', 'Done'), 'ok'); setActive(null); load() }
    catch { toast(t('处置失败', 'Failed'), 'error') }
  }

  if (reports === null) return <Spinner />
  return (
    <div className="flex flex-col gap-4">
      <Section title={t('待处理', 'Open')} count={open.length}>
        {open.length === 0 ? <EmptyState icon={<IconFlag />} title={t('没有待处理举报', 'No open reports')} /> : (
          <ul className="divide-y divide-[var(--line)]">{open.map((r) => <ReportRow key={r.id} r={r} t={t} onClick={() => setActive(r)} />)}</ul>
        )}
      </Section>
      {done.length > 0 && (
        <Section title={t('已处理', 'Resolved')} count={done.length}>
          <ul className="divide-y divide-[var(--line)]">{done.map((r) => <ReportRow key={r.id} r={r} t={t} onClick={() => setActive(r)} />)}</ul>
        </Section>
      )}
      {active && <ModerateDialog r={active} onClose={() => setActive(null)} onModerate={moderate} />}
    </div>
  )
}

function ReportRow({ r, onClick, t }: { r: AdminReport; onClick: () => void; t: (z: string, e: string) => string }) {
  return (
    // 行内容包 <button>：<li> 保留 listitem，按钮可键盘聚焦/激活（管理员用键盘打开举报详情）。
    <li>
      <button type="button" onClick={onClick} className="flex w-full items-center gap-3 px-4 py-3 text-left hover:surface-2">
        <Avatar name={r.targetName} size={36} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm"><span className="font-medium">{r.reporterName}</span> → <span className="font-medium">{r.targetName}</span></div>
          <div className="truncate text-xs text-faint">{r.reason}</div>
        </div>
        {r.evidenceRecordingId && <Pill tone="honey">{t('有录制', 'Evidence')}</Pill>}
        <Pill tone={r.status === 'resolved' ? 'ok' : 'danger'}>{r.decision || (r.status === 'resolved' ? t('已处理', 'Resolved') : t('待处理', 'Open'))}</Pill>
      </button>
    </li>
  )
}

function ModerateDialog({ r, onClose, onModerate }: { r: AdminReport; onClose: () => void; onModerate: (id: string, a: 'dismiss' | 'warn' | 'suspend' | 'ban', reason: string) => void }) {
  const { t } = useI18n()
  const [reason, setReason] = useState('')
  const acts: { a: 'dismiss' | 'warn' | 'suspend' | 'ban'; label: string; tone: 'soft' | 'primary' | 'danger' }[] = [
    { a: 'dismiss', label: t('忽略', 'Dismiss'), tone: 'soft' },
    { a: 'warn', label: t('警告', 'Warn'), tone: 'primary' },
    { a: 'suspend', label: t('暂停', 'Suspend'), tone: 'danger' },
    { a: 'ban', label: t('封禁', 'Ban'), tone: 'danger' },
  ]
  return (
    <Modal onClose={onClose} label={t('处置举报', 'Moderate report')} panelClassName="w-full max-w-md">
        <h3 className="text-lg font-semibold">{t('处置举报', 'Moderate report')}</h3>
        <div className="mt-3 space-y-1 text-sm">
          <div><span className="text-faint">{t('举报人', 'Reporter')}：</span>{r.reporterName}</div>
          <div><span className="text-faint">{t('被举报', 'Target')}：</span>{r.targetName}</div>
          <div><span className="text-faint">{t('理由', 'Reason')}：</span>{r.reason}</div>
        </div>
        <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} maxLength={500} placeholder={t('处置说明（必填）', 'Decision note (required)')}
          className="mt-3 w-full resize-none rounded-xl border border-[var(--line)] surface-2 px-3 py-2 text-sm outline-none focus:border-honey" />
        <div className="mt-4 grid grid-cols-2 gap-2">
          {acts.map((x) => <Button key={x.a} variant={x.tone} disabled={!reason.trim()} onClick={() => onModerate(r.id, x.a, reason.trim())}>{x.label}</Button>)}
        </div>
        <button onClick={onClose} className="mt-3 w-full text-center text-sm text-faint hover:underline">{t('取消', 'Cancel')}</button>
    </Modal>
  )
}

function UsersTab() {
  const { t, lang } = useI18n()
  const toast = useToast()
  const [q, setQ] = useState('')
  const [users, setUsers] = useState<AdminUser[] | null>(null)
  const [total, setTotal] = useState(0)
  // isCurrent 守卫：cleanup 只清未触发的 timer，不取消已发出的请求；快速改搜索词时旧关键词若晚返回会覆盖
  // 新结果（乱序竞态），管理员可能对错误用户执行启停。仅当本次仍是最新请求时才写入 state。
  const load = useCallback((term: string, isCurrent: () => boolean = () => true) =>
    void api.adminUsers({ q: term, limit: 50 })
      .then((r) => { if (isCurrent()) { setUsers(r.users); setTotal(r.total) } })
      .catch(() => { if (isCurrent()) setUsers([]) }), [])
  useEffect(() => { let alive = true; const id = setTimeout(() => load(q, () => alive), 300); return () => { alive = false; clearTimeout(id) } }, [q, load])

  const toggle = async (u: AdminUser) => {
    const next = u.status === 'active' ? 'disabled' : 'active'
    try { await api.adminSetStatus(u.id, next); setUsers((cur) => cur?.map((x) => x.id === u.id ? { ...x, status: next } : x) ?? cur) }
    catch { toast(t('操作失败（可能受最后管理员保护）', 'Failed (last-admin protection?)'), 'error') }
  }

  return (
    <div className="flex flex-col gap-3">
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('搜索用户名 / 昵称 / 邮箱 / 手机', 'Search username / name / email / phone')} />
      <Card className="overflow-hidden">
        {users === null ? <Spinner /> : users.length === 0 ? <EmptyState icon={<IconUsers />} title={t('无匹配用户', 'No users')} /> : (
          <>
            <ul className="divide-y divide-[var(--line)]">
              {users.map((u) => (
                <li key={u.id} className="flex items-center gap-3 px-4 py-3">
                  <Avatar name={u.displayName} src={u.avatar} size={38} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5"><span className="truncate font-medium">{u.displayName}</span>{u.online && <span className="h-2 w-2 rounded-full bg-ok" />}</div>
                    <div className="truncate text-xs text-faint">@{u.username} · {roleLabel(u.role, t)} · {fmtTime(u.createdAt, lang)}</div>
                  </div>
                  <Pill tone={u.status === 'active' ? 'ok' : 'danger'}>{u.status === 'active' ? t('活跃', 'Active') : t('停用', 'Disabled')}</Pill>
                  <Button variant="soft" onClick={() => toggle(u)}>{u.status === 'active' ? t('停用', 'Disable') : t('启用', 'Enable')}</Button>
                </li>
              ))}
            </ul>
            <div className="px-4 py-2 text-center text-xs text-faint">{t('显示', 'Showing')} {users.length} / {total} · {t('更复杂的管理见完整控制台', 'Advanced ops in full console')}</div>
          </>
        )}
      </Card>
    </div>
  )
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <Card className="overflow-hidden">
      <div className="flex items-center gap-2 border-b border-[var(--line)] px-4 py-3"><span className="text-sm font-semibold">{title}</span><Pill>{count}</Pill></div>
      {children}
    </Card>
  )
}
