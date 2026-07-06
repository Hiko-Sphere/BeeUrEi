import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type CallRecordInfo } from '../lib/api'
import { pollWhileVisible } from '../lib/poll'
import { useSession } from '../lib/session'
import { useI18n } from '../lib/i18n'
import { Card, Spinner, EmptyState } from '../components/ui'
import { CallHistoryRow } from '../components/CallHistoryRow'
import { useCall } from './call/CallController'
import { IconPhone, IconChat, IconUsers, IconBell } from '../components/icons'

interface Stats { online: number; total: number; incoming: number; queue: number; unread: number; unreadMessages: number; missedCalls: number; pendingLinks: number }

export function HomePage() {
  const { user } = useSession()
  const { t } = useI18n()
  const { active, startOutgoing } = useCall()
  // 首页最近通话也支持一键回拨（与通话页同款）：未接的紧急求助尤其需要快速回拨。
  const callBack = (c: CallRecordInfo) => { if (c.peerId) void startOutgoing(c.peerId, c.peerName || t('对方', 'Them'), c.peerAvatar ?? null) }
  const [stats, setStats] = useState<Stats | null>(null)
  const [calls, setCalls] = useState<CallRecordInfo[] | null>(null)

  useEffect(() => {
    let alive = true
    const load = async () => {
      // 未读汇总用轻量计数端点 unreadSummary（含 messages/notifications/missedCalls），
      // 替代此前为拿一个 unread 计数却拉整份通知列表（≤100 条）的浪费。
      const [oc, inc, q, sum, links, hist] = await Promise.allSettled([
        api.onlineCount(), api.incomingCalls(), api.helpQueue(), api.unreadSummary(), api.incomingLinks(), api.callHistory(),
      ])
      if (!alive) return
      setStats({
        online: oc.status === 'fulfilled' ? oc.value.online : 0,
        total: oc.status === 'fulfilled' ? oc.value.total : 0,
        incoming: inc.status === 'fulfilled' ? inc.value.calls.length : 0,
        queue: q.status === 'fulfilled' ? q.value.count : 0,
        unread: sum.status === 'fulfilled' ? sum.value.notifications : 0,
        unreadMessages: sum.status === 'fulfilled' ? sum.value.messages : 0,
        missedCalls: sum.status === 'fulfilled' ? (sum.value.missedCalls ?? 0) : 0,
        pendingLinks: links.status === 'fulfilled' ? links.value.links.length : 0,
      })
      if (hist.status === 'fulfilled') setCalls(hist.value.calls.slice(0, 6)); else setCalls((c) => c ?? []) // 失败也退出加载态（stats 已带默认值，calls 此前会永远转圈）
    }
    void load()
    const stop = pollWhileVisible(load, 15_000)
    return () => { alive = false; stop() }
  }, [])

  const hour = new Date().getHours()
  const greet = hour < 6 ? t('夜深了', 'Good night') : hour < 12 ? t('早上好', 'Good morning') : hour < 18 ? t('下午好', 'Good afternoon') : t('晚上好', 'Good evening')

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{greet}{user ? `，${user.displayName}` : ''}</h1>
        <p className="mt-1 text-sm text-faint">{t('在「待命中」时，绑定的视障用户即可呼叫你协助。', 'Turn on “Available” so linked users can call you for help.')}</p>
      </div>

      {/* 统计卡片：按"谁需要我"的紧急度排序——待接/求助/未接来电/未读消息在前，未读通知/待确认在后。 */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard to="/calls" icon={<IconPhone />} value={stats?.incoming ?? 0} label={t('待接来电', 'Incoming')} tone={stats?.incoming ? 'honey' : 'soft'} />
        <StatCard to="/calls" icon={<IconUsers />} value={stats?.queue ?? 0} label={t('求助队列', 'Help queue')} tone={stats?.queue ? 'honey' : 'soft'} />
        <StatCard to="/calls" icon={<IconPhone />} value={stats?.missedCalls ?? 0} label={t('未接来电', 'Missed calls')} tone={stats?.missedCalls ? 'danger' : 'soft'} />
        <StatCard to="/chat" icon={<IconChat />} value={stats?.unreadMessages ?? 0} label={t('未读消息', 'Unread chats')} tone={stats?.unreadMessages ? 'honey' : 'soft'} />
        <StatCard to="/notifications" icon={<IconBell />} value={stats?.unread ?? 0} label={t('未读通知', 'Unread')} tone={stats?.unread ? 'danger' : 'soft'} />
        <StatCard to="/family" icon={<IconUsers />} value={stats?.pendingLinks ?? 0} label={t('待确认联系人', 'Pending links')} tone={stats?.pendingLinks ? 'honey' : 'soft'} />
      </div>

      {/* 在线协助网络 */}
      <Card className="p-5">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm text-faint">{t('你的协助网络', 'Your assist network')}</div>
            <div className="mt-1 text-2xl font-bold">{stats ? `${stats.online}/${stats.total}` : '—'}</div>
            <div className="text-xs text-faint">{t('在线 / 已绑定的视障用户', 'online / linked blind users')}</div>
          </div>
          <Link to="/family" className="text-sm font-medium text-accent hover:underline">{t('管理联系人', 'Manage')}</Link>
        </div>
      </Card>

      {/* 快捷入口 */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <QuickLink to="/calls" icon={<IconPhone />} title={t('接听 / 求助队列', 'Calls & queue')} desc={t('查看来电与公开求助', 'Incoming calls and open requests')} />
        <QuickLink to="/chat" icon={<IconChat />} title={t('消息', 'Messages')} desc={t('与联系人收发消息', 'Chat with your contacts')} />
        <QuickLink to="/family" icon={<IconUsers />} title={t('联系人', 'Contacts')} desc={t('添加 / 确认亲友关系', 'Add and confirm links')} />
      </div>

      {/* 最近通话 */}
      <Card className="overflow-hidden">
        <div className="border-b border-[var(--line)] px-5 py-3 text-sm font-semibold">{t('最近通话', 'Recent calls')}</div>
        {calls === null ? <Spinner /> : calls.length === 0 ? (
          <EmptyState icon={<IconPhone />} title={t('暂无通话记录', 'No calls yet')} message={t('接听或发起通话后会显示在这里', 'Calls will appear here')} />
        ) : (
          <ul className="divide-y divide-[var(--line)]">
            {calls.map((c) => <CallHistoryRow key={c.id} call={c} className="px-5 py-3" onCall={callBack} callDisabled={!!active} />)}
          </ul>
        )}
      </Card>
    </div>
  )
}

function StatCard({ to, icon, value, label, tone }: { to: string; icon: React.ReactNode; value: number; label: string; tone: 'soft' | 'honey' | 'danger' }) {
  const ring = tone === 'honey' ? 'ring-honey/40' : tone === 'danger' ? 'ring-danger/40' : 'ring-transparent'
  return (
    <Link to={to} className={`surface rounded-2xl border border-[var(--line)] p-4 ring-1 transition hover:brightness-[1.02] ${ring}`}>
      <div className={`mb-2 ${tone === 'soft' ? 'text-faint' : tone === 'danger' ? 'text-danger' : 'text-honey'}`}>{icon}</div>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs text-faint">{label}</div>
    </Link>
  )
}

function QuickLink({ to, icon, title, desc }: { to: string; icon: React.ReactNode; title: string; desc: string }) {
  return (
    <Link to={to} className="surface flex items-start gap-3 rounded-2xl border border-[var(--line)] p-4 transition hover:brightness-[1.02]">
      <div className="rounded-xl bg-honey/15 p-2 text-honey">{icon}</div>
      <div>
        <div className="text-sm font-semibold">{title}</div>
        <div className="text-xs text-faint">{desc}</div>
      </div>
    </Link>
  )
}
