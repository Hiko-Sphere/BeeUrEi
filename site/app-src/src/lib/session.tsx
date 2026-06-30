import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react'
import { api, tokenStore, setUnauthorizedHandler, type User, type SelfView } from './api'

interface Session {
  user: User | null
  self: SelfView | null
  ready: boolean
  requireVerification: boolean // 管理员是否要求实名认证（未通过的用户被门禁屏拦住）
  signIn: (token: string, refresh: string, user: User) => void
  signOut: () => void
  refreshMe: () => Promise<void>
}
const Ctx = createContext<Session>({ user: null, self: null, ready: false, requireVerification: false, signIn: () => {}, signOut: () => {}, refreshMe: async () => {} })

export function SessionProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(tokenStore.user)
  const [self, setSelf] = useState<SelfView | null>(null)
  const [ready, setReady] = useState(false)
  const [requireVerification, setRequireVerification] = useState(false)

  const signOut = useCallback(() => {
    const rt = tokenStore.refresh
    if (rt) void api.logout(rt).catch(() => {}) // 尽力而为：服务端吊销 refresh token；先读再清，失败/离线也照常登出
    tokenStore.clear(); setUser(null); setSelf(null)
  }, [])

  const refreshMe = useCallback(async () => {
    if (!tokenStore.token) { setUser(null); return }
    try {
      const me = await api.me()
      setSelf(me); setUser(me); tokenStore.setUser(me)
      // 拉取全站配置以获知是否要求实名认证（fail-open：失败保持现状，不误锁）。app-config 对未认证用户也放行。
      try { const cfg = await api.appConfig(); setRequireVerification(!!cfg.requireVerification) } catch { /* 保持现状 */ }
    } catch { /* 401 由 unauthorized handler 处理 */ }
  }, [])

  const signIn = useCallback((token: string, refresh: string, u: User) => {
    tokenStore.set(token, refresh, u); setUser(u)
    // 走 refreshMe：同时拉 /api/me 与 /api/app-config，使登录后立刻获知 requireVerification——
    // 否则未实名用户登录后会落到正常 UI 且所有请求 403（见复审 CLIENT-MED）。
    void refreshMe()
  }, [refreshMe])

  useEffect(() => {
    setUnauthorizedHandler(() => { setUser(null); setSelf(null) })
    void (async () => { await refreshMe(); setReady(true) })()
  }, [refreshMe])

  return <Ctx.Provider value={{ user, self, ready, requireVerification, signIn, signOut, refreshMe }}>{children}</Ctx.Provider>
}

export const useSession = () => useContext(Ctx)
