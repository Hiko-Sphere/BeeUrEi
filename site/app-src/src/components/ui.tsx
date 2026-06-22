import { createContext, useContext, useState, useCallback, type ReactNode, type ButtonHTMLAttributes, type InputHTMLAttributes } from 'react'

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
  const initial = (name || '?').trim().charAt(0).toUpperCase()
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
  return <div className="flex justify-center py-10"><span className="inline-block h-6 w-6 rounded-full border-2 border-[var(--text-faint)] border-t-transparent spin" /></div>
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
          <div key={t.id} className={`slide-up pointer-events-auto max-w-sm rounded-xl px-4 py-2.5 text-sm shadow-lg ${t.tone === 'error' ? 'bg-danger text-white' : t.tone === 'ok' ? 'bg-ok text-white' : 'surface border border-[var(--line)] text-[var(--text)]'}`}>{t.text}</div>
        ))}
      </div>
    </ToastCtx.Provider>
  )
}

export function timeAgo(ms: number, lang: 'zh' | 'en'): string {
  const d = Date.now() - ms
  const m = Math.floor(d / 60000), h = Math.floor(d / 3600000), day = Math.floor(d / 86400000)
  if (m < 1) return lang === 'zh' ? '刚刚' : 'just now'
  if (h < 1) return lang === 'zh' ? `${m} 分钟前` : `${m}m ago`
  if (day < 1) return lang === 'zh' ? `${h} 小时前` : `${h}h ago`
  if (day < 7) return lang === 'zh' ? `${day} 天前` : `${day}d ago`
  return new Date(ms).toLocaleDateString(lang === 'zh' ? 'zh-CN' : 'en-US')
}
export function fmtTime(ms: number, lang: 'zh' | 'en'): string {
  return new Date(ms).toLocaleString(lang === 'zh' ? 'zh-CN' : 'en-US', { dateStyle: 'medium', timeStyle: 'short' })
}
export function fmtDuration(sec: number): string { const m = Math.floor(sec / 60), s = sec % 60; return `${m}:${String(s).padStart(2, '0')}` }
