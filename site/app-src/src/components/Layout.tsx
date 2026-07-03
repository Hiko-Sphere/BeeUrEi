import { useEffect, useRef, useState, type ReactNode } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { useSession } from '../lib/session'
import { useI18n } from '../lib/i18n'
import { api, type AppConfig } from '../lib/api'
import { getTheme, setTheme, appTitle, type Theme } from '../lib/theme'
import { Avatar, Pill } from './ui'
import { CallProvider } from '../pages/call/CallController'
import { IconHome, IconPhone, IconChat, IconUsers, IconFilm, IconBell, IconUser, IconShield, IconLogo, IconPin, IconFlag } from './icons'

const HEARTBEAT_MS = 25_000
const LS_AVAIL = 'beeurei.web.available'

interface NavItem { to: string; label: string; icon: ReactNode; badge?: number }

export function Layout({ children }: { children: ReactNode }) {
  const { user, signOut } = useSession()
  const { t, lang, setLang } = useI18n()
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [unread, setUnread] = useState(0)       // 铃铛通知未读（好友请求/紧急/举报等）
  const [chatUnread, setChatUnread] = useState(0) // 聊天未读（单聊+群聊）
  const [available, setAvailable] = useState<boolean>(() => { try { return localStorage.getItem(LS_AVAIL) === '1' } catch { return false } })
  const [menuOpen, setMenuOpen] = useState(false)
  const loc = useLocation()

  // 全站配置（公告/维护横幅、录制策略） + 通知未读数轮询。
  // 通知轮询**始终运行**（含后台标签）：协助者把页面切后台时正是最需要知道"有盲人需要我"的时候，
  // 由标签标题的未读前缀提醒（页内铃铛在后台看不到）。与在线心跳同策略——不随可见性暂停。
  useEffect(() => {
    let alive = true
    void api.appConfig().then((c) => alive && setConfig(c)).catch(() => {})
    const tick = () => void api.unreadSummary().then((s) => { if (alive) { setUnread(s.notifications); setChatUnread(s.messages) } }).catch(() => {})
    tick()
    const id = setInterval(tick, 30_000)
    return () => { alive = false; clearInterval(id) }
  }, [loc.pathname])

  // 浏览器标签标题带未读总数前缀 "(N) BeeUrEi 协助者"（聊天+通知）：后台标签也能在标签条看到有未读。
  useEffect(() => {
    const total = unread + chatUnread
    document.title = (total > 0 ? `(${total > 99 ? '99+' : total}) ` : '') + appTitle(lang)
  }, [unread, chatUnread, lang])

  // 待命心跳：开启后周期上报 available=true，让绑定的视障侧看到「在线」并能呼入；关闭立即下线。
  const availRef = useRef(available)
  availRef.current = available
  useEffect(() => {
    try { localStorage.setItem(LS_AVAIL, available ? '1' : '0') } catch { /* ignore */ }
    if (!available) { void api.heartbeat(false).catch(() => {}); return }
    void api.heartbeat(true).catch(() => {})
    const id = setInterval(() => { if (availRef.current) void api.heartbeat(true).catch(() => {}) }, HEARTBEAT_MS)
    return () => clearInterval(id)
  }, [available])

  // 关闭页面前主动下线（best-effort）。
  useEffect(() => {
    const onUnload = () => { if (availRef.current) void api.heartbeat(false).catch(() => {}) }
    window.addEventListener('pagehide', onUnload)
    return () => window.removeEventListener('pagehide', onUnload)
  }, [])

  if (!user) return <>{children}</>

  const nav: NavItem[] = [
    { to: '/', label: t('主页', 'Home'), icon: <IconHome /> },
    { to: '/calls', label: t('通话', 'Calls'), icon: <IconPhone /> },
    { to: '/chat', label: t('消息', 'Chat'), icon: <IconChat />, badge: chatUnread },
    { to: '/family', label: t('亲友', 'Contacts'), icon: <IconUsers /> },
    { to: '/locations', label: t('位置', 'Location'), icon: <IconPin /> },
    { to: '/routes', label: t('路线', 'Routes'), icon: <IconFlag /> },
    { to: '/recordings', label: t('录音', 'Recordings'), icon: <IconFilm /> },
    { to: '/notifications', label: t('通知', 'Alerts'), icon: <IconBell />, badge: unread },
    { to: '/account', label: t('账户', 'Account'), icon: <IconUser /> },
  ]
  if (user.role === 'admin') nav.push({ to: '/admin', label: t('管理', 'Admin'), icon: <IconShield /> })

  // 路由切换朗读（SPA 无障碍，WCAG 4.1.3）：读屏用户点导航后内容整片替换、焦点仍留在链接、
  // 新页面无声。取当前路由最长前缀匹配的导航项标题，喂给下方持久 aria-live 隐藏区，跳转即播报页名。
  const activeLabel = activeNavLabel(loc.pathname, nav, 'BeeUrEi')

  const cycleTheme = () => { const order: Theme[] = ['auto', 'light', 'dark']; const cur = getTheme(); setTheme(order[(order.indexOf(cur) + 1) % 3]) }
  const themeLabel = { auto: t('跟随系统', 'Auto'), light: t('浅色', 'Light'), dark: t('深色', 'Dark') }[getTheme()]

  return (
    <CallProvider>
      <div className="min-h-dvh">
        {/* 路由切换朗读：持久隐藏 aria-live 区，路由变化时播报当前页名，读屏用户跳转后知道身处何页。 */}
        <div aria-live="polite" aria-atomic="true" className="sr-only">{activeLabel}</div>
        {/* 全站公告 / 维护横幅 */}
        {config?.maintenance?.enabled && (
          <div className="bg-danger px-4 py-2 text-center text-sm font-medium text-white">{config.maintenance.message || t('系统维护中', 'Under maintenance')}</div>
        )}
        {config?.announcement?.enabled && config.announcement.text && (
          <div className="bg-honey/20 px-4 py-2 text-center text-sm text-[var(--text)]">{config.announcement.text}</div>
        )}

        {/* 顶栏 */}
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-[var(--line)] surface px-4 backdrop-blur supports-[backdrop-filter]:bg-[color:var(--surface)]/80">
          <div className="flex items-center gap-2">
            <IconLogo />
            <span className="font-semibold tracking-tight">BeeUrEi</span>
            <Pill tone="honey">{t('协助端', 'Helper')}</Pill>
          </div>
          <div className="flex-1" />
          {/* 待命开关 */}
          <button onClick={() => setAvailable((v) => !v)}
            className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition ${available ? 'border-ok/40 bg-ok/10 text-ok' : 'border-[var(--line)] text-faint'}`}
            aria-pressed={available}>
            <span className={`inline-block h-2 w-2 rounded-full ${available ? 'bg-ok ring-live' : 'bg-[var(--text-faint)]'}`} />
            {available ? t('待命中', 'Available') : t('离线', 'Offline')}
          </button>
          <button onClick={cycleTheme} className="rounded-lg px-2 py-1.5 text-xs text-soft hover:surface-2" title={themeLabel}>{themeLabel}</button>
          <button onClick={() => setLang(lang === 'zh' ? 'en' : 'zh')} className="rounded-lg px-2 py-1.5 text-xs text-soft hover:surface-2">{lang === 'zh' ? 'EN' : '中文'}</button>
          <div className="relative">
            <button onClick={() => setMenuOpen((v) => !v)} className="flex items-center gap-2 rounded-full p-0.5 hover:surface-2"
              aria-label={t('账户菜单', 'Account menu')} aria-haspopup="menu" aria-expanded={menuOpen}>
              <Avatar name={user.displayName} src={user.avatar} size={32} />
            </button>
            {menuOpen && (
              <>
                <div className="fixed inset-0 z-40" onClick={() => setMenuOpen(false)} />
                <div className="absolute right-0 z-50 mt-2 w-52 overflow-hidden rounded-xl border border-[var(--line)] surface shadow-lg">
                  <div className="border-b border-[var(--line)] px-4 py-3">
                    <div className="truncate font-medium">{user.displayName}</div>
                    <div className="truncate text-xs text-faint">@{user.username} · {roleLabel(user.role, t)}</div>
                  </div>
                  <button onClick={() => { setMenuOpen(false); signOut() }} className="block w-full px-4 py-2.5 text-left text-sm text-danger hover:surface-2">{t('退出登录', 'Sign out')}</button>
                </div>
              </>
            )}
          </div>
        </header>

        <div className="mx-auto flex w-full max-w-6xl gap-6 px-3 pb-24 pt-4 md:px-6 md:pb-8">
          {/* 侧栏（桌面） */}
          <aside className="sticky top-20 hidden h-fit w-52 shrink-0 flex-col gap-1 md:flex">
            {nav.map((n) => <NavItemLink key={n.to} item={n} />)}
          </aside>
          <main className="min-w-0 flex-1">{children}</main>
        </div>

        {/* 底部标签栏（移动）：横向可滚动，容纳全部入口，绝不裁切（任意角色项数都可达）。 */}
        <nav className="fixed inset-x-0 bottom-0 z-30 flex overflow-x-auto border-t border-[var(--line)] surface md:hidden">
          {nav.map((n) => (
            <NavLink key={n.to} to={n.to} end={n.to === '/'}
              className={({ isActive }) => `relative flex min-w-[3.6rem] flex-1 flex-col items-center gap-0.5 py-2 text-[10px] ${isActive ? 'text-honey' : 'text-faint'}`}>
              <span className="relative">{n.icon}{!!n.badge && n.badge > 0 && <span className="absolute -right-2 -top-1 rounded-full bg-danger px-1 text-[9px] font-bold text-white">{n.badge > 99 ? '99+' : n.badge}</span>}</span>
              {n.label}
            </NavLink>
          ))}
        </nav>
      </div>
    </CallProvider>
  )
}

function NavItemLink({ item }: { item: NavItem }) {
  return (
    <NavLink to={item.to} end={item.to === '/'}
      className={({ isActive }) => `flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition ${isActive ? 'bg-honey/15 text-[var(--text)]' : 'text-soft hover:surface-2'}`}>
      <span className="relative">{item.icon}{!!item.badge && item.badge > 0 && <span className="absolute -right-2 -top-1.5 rounded-full bg-danger px-1 text-[9px] font-bold text-white">{item.badge > 99 ? '99+' : item.badge}</span>}</span>
      {item.label}
    </NavLink>
  )
}

/// 当前路由最长前缀匹配的导航项标题（'/' 仅精确匹配；/chat/:id→消息、/admin/reports→管理）。
/// 供路由切换的 aria-live 朗读用；纯函数，可单测。
export function activeNavLabel(pathname: string, items: { to: string; label: string }[], fallback: string): string {
  return items
    .filter((n) => (n.to === '/' ? pathname === '/' : pathname === n.to || pathname.startsWith(n.to + '/')))
    .sort((a, b) => b.to.length - a.to.length)[0]?.label ?? fallback
}

export function roleLabel(role: string, t: (zh: string, en: string) => string): string {
  switch (role) {
    case 'blind': return t('视障用户', 'Blind user')
    case 'helper': return t('志愿者', 'Volunteer')
    case 'family': return t('亲友', 'Family')
    case 'admin': return t('管理员', 'Admin')
    case 'developer': return t('开发者', 'Developer')
    default: return role
  }
}
