import { createContext, useContext, useEffect, useRef, useState, useCallback, type ReactNode, type ButtonHTMLAttributes, type InputHTMLAttributes } from 'react'
import { useI18n } from '../lib/i18n'

// ---------- Button ----------
type Variant = 'primary' | 'ghost' | 'danger' | 'soft' | 'ok'
const variants: Record<Variant, string> = {
  primary: 'bg-honey text-ink hover:brightness-105 active:brightness-95 font-semibold',
  danger: 'bg-danger text-white hover:brightness-110 font-semibold',
  ok: 'bg-ok text-white hover:brightness-110 font-semibold',
  soft: 'surface-2 text-[var(--text)] hover:brightness-105 border border-[var(--line)]',
  ghost: 'text-[var(--text-soft)] hover:surface-2',
}
export function Button({ variant = 'primary', loading, className = '', children, ...rest }: { variant?: Variant; loading?: boolean } & ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button {...rest} disabled={rest.disabled || loading}
      className={`inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-xl px-4 py-2.5 text-sm transition disabled:opacity-50 disabled:cursor-not-allowed ${variants[variant]} ${className}`}>
      {loading && <span className="inline-block h-4 w-4 rounded-full border-2 border-current border-t-transparent spin" aria-hidden />}
      {children}
    </button>
  )
}

// ---------- Card ----------
export function Card({ className = '', children }: { className?: string; children: ReactNode }) {
  return <div className={`surface rounded-2xl border border-[var(--line)] ${className}`}>{children}</div>
}

// ---------- Field / Input ----------
export function Field({ label, hint, children }: { label?: string; hint?: string; children: ReactNode }) {
  return (
    <label className="block">
      {label && <span className="mb-1.5 block text-sm font-medium text-soft">{label}</span>}
      {children}
      {hint && <span className="mt-1 block text-xs text-faint">{hint}</span>}
    </label>
  )
}
export function Input({ className = '', ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input {...rest} className={`w-full rounded-xl border border-[var(--line)] surface-2 px-3.5 py-2.5 text-sm text-[var(--text)] outline-none placeholder:text-[var(--text-faint)] focus:border-honey ${className}`} />
}

// ---------- Avatar ----------
export function Avatar({ name, src, size = 40 }: { name: string; src?: string | null; size?: number }) {
  // 按 Unicode 码点取首字符：charAt(0) 对以 emoji/增补平面字（如「🎉」「𠮷」）开头的名字
  // 会截出半个代理对、显示成乱码方块。用展开运算符按码点取。
  const initial = ([...(name || '?').trim()][0] ?? '?').toUpperCase()
  if (src) return <img src={src} alt="" width={size} height={size} className="rounded-full object-cover" style={{ width: size, height: size }} />
  return (
    <span className="inline-flex shrink-0 items-center justify-center rounded-full bg-honey/20 font-semibold text-[var(--text)]"
      style={{ width: size, height: size, fontSize: size * 0.42 }} aria-hidden>{initial}</span>
  )
}

// ---------- Pill ----------
export function Pill({ tone = 'soft', children }: { tone?: 'soft' | 'honey' | 'danger' | 'ok'; children: ReactNode }) {
  const tones = { soft: 'surface-2 text-soft', honey: 'bg-honey/20 text-[var(--text)]', danger: 'bg-danger/15 text-danger', ok: 'bg-ok/15 text-ok' }
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ${tones[tone]}`}>{children}</span>
}

// ---------- Empty state ----------
export function EmptyState({ icon = '✦', title, message }: { icon?: ReactNode; title: string; message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-14 text-center">
      <div className="text-4xl opacity-40" aria-hidden>{icon}</div>
      <div className="font-semibold">{title}</div>
      {message && <div className="max-w-xs text-sm text-faint">{message}</div>}
    </div>
  )
}

export function Spinner() {
  // role=status + aria-label：读屏用户听到"加载中"，否则纯视觉转圈对盲人是一片静默。
  // 内层视觉转圈 aria-hidden（装饰）。
  const { t } = useI18n()
  return (
    <div role="status" aria-label={t('加载中', 'Loading')} className="flex justify-center py-10">
      <span aria-hidden="true" className="inline-block h-6 w-6 rounded-full border-2 border-[var(--text-faint)] border-t-transparent spin" />
    </div>
  )
}

// 统一弹窗：把全仓重复的 backdrop+面板+stopPropagation 收敛到一处，并一次性补齐无障碍语义——
// role=dialog + aria-modal（读屏将弹窗外内容视为 inert）、aria-label（弹窗有名）、Esc 关闭、
// 点遮罩关闭、点面板内不关闭。panelClassName 传各弹窗自有的尺寸/布局类（max-w/max-h/flex 等）。
// 注：通话类弹窗（来电/通话中）语义上不可点遮罩关闭，不走此组件。
export function Modal({ onClose, label, panelClassName = 'w-full max-w-md', dismissible = true, role = 'dialog', children }: {
  // dismissible=false：Escape/背景点击**不**关闭——用于生命安全告警（摔倒/SOS），须显式点按钮确认，
  // 防反射性 Escape 或误点把"家人可能摔倒了"的告警悄悄清掉（同来电铃"必须显式选择"口径）。
  // role='alertdialog'：需要用户响应的告警对话框（读屏更强的打断式播报），一般对话框用默认 'dialog'。
  onClose: () => void; label: string; panelClassName?: string; dismissible?: boolean; role?: 'dialog' | 'alertdialog'; children: ReactNode
}) {
  const panelRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    // 焦点管理：开弹窗时把焦点移入面板（读屏据 aria-label 播报弹窗、键盘从此处起 Tab）；
    // 关弹窗时恢复到打开前聚焦的元素（否则键盘焦点丢回页面顶部）。
    const prev = document.activeElement as HTMLElement | null
    panelRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { if (dismissible) onClose(); return } // 不可关时 Escape 无效（须显式确认）
      if (e.key !== 'Tab') return
      // 焦点陷阱：Tab 在弹窗内循环，不逃逸到背景（背景已 aria-modal 视为 inert，键盘焦点也应被困住）。
      const panel = panelRef.current
      if (!panel) return
      const f = panel.querySelectorAll<HTMLElement>('a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')
      if (f.length === 0) { e.preventDefault(); panel.focus(); return }
      const first = f[0], last = f[f.length - 1], active = document.activeElement
      if (e.shiftKey && (active === first || active === panel)) { e.preventDefault(); last.focus() }
      else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus() }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      prev?.focus?.()
    }
  }, [onClose, dismissible])
  return (
    <div className="fixed inset-0 z-[120] grid place-items-center bg-black/50 p-4" onClick={dismissible ? onClose : undefined}>
      <div ref={panelRef} tabIndex={-1} role={role} aria-modal="true" aria-label={label} onClick={(e) => e.stopPropagation()}
        className={`slide-up rounded-2xl surface border border-[var(--line)] p-6 shadow-2xl outline-none ${panelClassName}`}>
        {children}
      </div>
    </div>
  )
}

// ---------- Toast ----------
type Toast = { id: number; text: string; tone: 'info' | 'error' | 'ok' }
const ToastCtx = createContext<(text: string, tone?: Toast['tone']) => void>(() => {})
export const useToast = () => useContext(ToastCtx)
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const push = useCallback((text: string, tone: Toast['tone'] = 'info') => {
    const id = Date.now() + Math.floor(performance.now())
    setToasts((t) => [...t, { id, text, tone }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3200)
  }, [])
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[100] flex flex-col items-center gap-2 px-4">
        {toasts.map((t) => (
          // 每条 toast 自带 live-region 角色：盲人/读屏用户也能听到反馈（视障+协助者是本应用核心用户）。
          // error→role=alert(assertive，打断朗读，如"内容被禁/发送失败")；其余→role=status(polite)。
          // 按条加角色而非容器统一 aria-live，避免容器+子节点双重 live 区导致重复朗读。
          <div key={t.id} role={t.tone === 'error' ? 'alert' : 'status'}
            className={`slide-up pointer-events-auto max-w-sm rounded-xl px-4 py-2.5 text-sm shadow-lg ${t.tone === 'error' ? 'bg-danger text-white' : t.tone === 'ok' ? 'bg-ok text-white' : 'surface border border-[var(--line)] text-[var(--text)]'}`}>{t.text}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}

// 坏时间戳兜底：非有限 ms（NaN/undefined/null——某条服务端记录缺 createdAt/序列化异常）不谎报"刚刚"，
// 如实说"未知时间"（同 emergencyLocInfo 的诚实取向），且绝不把坏值喂给 Date（见 fmtTime/RelativeTime）。
function unknownTime(lang: 'zh' | 'en'): string { return lang === 'zh' ? '未知时间' : 'unknown time' }
export function timeAgo(ms: number, lang: 'zh' | 'en'): string {
  if (!Number.isFinite(ms)) return unknownTime(lang) // 否则落到 toLocaleDateString 渲染 "Invalid Date"
  const d = Date.now() - ms
  const m = Math.floor(d / 60000), h = Math.floor(d / 3600000), day = Math.floor(d / 86400000)
  if (m < 1) return lang === 'zh' ? '刚刚' : 'just now'
  if (h < 1) return lang === 'zh' ? `${m} 分钟前` : `${m}m ago`
  if (day < 1) return lang === 'zh' ? `${h} 小时前` : `${h}h ago`
  if (day < 7) return lang === 'zh' ? `${day} 天前` : `${day}d ago`
  return new Date(ms).toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US')
}
export function fmtTime(ms: number, lang: 'zh' | 'en'): string {
  if (!Number.isFinite(ms)) return unknownTime(lang) // 否则渲染 "Invalid Date"
  return new Date(ms).toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' })
}
/// 时钟时间 "HH:MM"（本地时区，locale-aware）：消息气泡在日期分隔之下只需显示"几点"——比相对时间("5天前")清晰，
/// 且与日期分隔不冗余（各主流 IM：日期分隔归天、气泡显时刻）。非有限 ms → 兜底文案（绝不喂 Date 渲染 "Invalid Date"）。
export function fmtHm(ms: number, lang: 'zh' | 'en'): string {
  if (!Number.isFinite(ms)) return unknownTime(lang)
  return new Date(ms).toLocaleTimeString(lang === 'zh' ? 'zh-CN' : 'en-US', { hour: '2-digit', minute: '2-digit' })
}
/// 相对时间展示（复用既有 timeAgo 措辞，全站一致）：可见文本相对（"刚刚"/"5 分钟前"），
/// 语义 <time> + `title`/`dateTime` 携带**精确绝对时间**——悬停可见、屏幕阅读器可取，无障碍。
/// ⚠️ 相对措辞仅宜用于"何时发生"的列表；**紧急"最后已知位置"等安全攸关时刻绝不可用**（相对会随阅读时刻
/// 漂移成谎言，把协助者指向错误的时间/地点，见 iOS EmergencyLocationTag 同一铁律）——那些保持 fmtTime 绝对。
export function RelativeTime({ ms, lang, className }: { ms: number; lang: 'zh' | 'en'; className?: string }) {
  // 非有限 ms 绝不喂给 Date：`new Date(NaN).toISOString()` 抛 RangeError，无错误边界会白屏整页
  // （尤以通知页——盲人发出的 SOS 就在这里，崩了协助者看不到）。此时降级为纯 <span> 兜底文案。
  if (!Number.isFinite(ms)) return <span className={className}>{timeAgo(ms, lang)}</span>
  return <time dateTime={new Date(ms).toISOString()} title={fmtTime(ms, lang)} className={className}>{timeAgo(ms, lang)}</time>
}
/// 时长 m:ss；≥1 小时用 h:mm:ss（否则服务器 uptime 等长时长会溢出成 "1666:40" 这类分钟数，管理台不可读）。
/// 非有限/负值兜底 0:00，避免任何调用点传入坏值时渲染 "NaN:NaN"。
export function fmtDuration(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '0:00'
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60)
  return h > 0
    ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
    : `${m}:${String(s).padStart(2, '0')}`
}
