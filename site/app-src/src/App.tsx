import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useSession } from './lib/session'
import { Spinner } from './components/ui'
import { LoginPage } from './pages/Login'
import { Layout } from './components/Layout'
import { HomePage } from './pages/Home'
import { CallsPage } from './pages/Calls'
import { ChatPage } from './pages/Chat'
import { FamilyPage } from './pages/Family'
import { RecordingsPage } from './pages/Recordings'
import { NotificationsPage } from './pages/Notifications'
import { AccountPage } from './pages/Account'
import { IncomingCallHost } from './pages/call/IncomingCallHost'
import { EmergencyAlertHost } from './pages/call/EmergencyAlertHost'
import { VerificationGate } from './pages/VerificationGate'

// 懒加载重/少用页，缩小首屏主包：Locations 带 Leaflet 地图库(~140KB)、Admin 仅管理员可达。
// 其余为核心页（多数会话都用），保持 eager 避免每次导航闪烁。
const LocationsPage = lazy(() => import('./pages/Locations').then((m) => ({ default: m.LocationsPage })))
const AdminPage = lazy(() => import('./pages/Admin').then((m) => ({ default: m.AdminPage })))
const RoutesPage = lazy(() => import('./pages/Routes').then((m) => ({ default: m.RoutesPage }))) // 带 Leaflet，与 Locations 同策略懒加载

export function App() {
  const { user, ready, requireVerification } = useSession()
  if (!ready) return <div className="grid min-h-dvh place-items-center"><Spinner /></div>
  if (!user) {
    return (
      <Routes>
        <Route path="*" element={<LoginPage />} />
      </Routes>
    )
  }
  // 实名认证门禁：管理员开启且当前用户(非 admin/developer)未通过 KYC → 取代整个应用为门禁屏。
  const gateable = user.role !== 'admin' && user.role !== 'developer'
  if (requireVerification && gateable && !user.verified) {
    return <VerificationGate />
  }
  return (
    <Layout>
      <IncomingCallHost />
      <EmergencyAlertHost />
      <Suspense fallback={<Spinner />}>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/calls" element={<CallsPage />} />
        <Route path="/chat" element={<ChatPage />} />
        <Route path="/chat/:peerId" element={<ChatPage />} />
        <Route path="/family" element={<FamilyPage />} />
        <Route path="/locations" element={<LocationsPage />} />
        <Route path="/routes" element={<RoutesPage />} />
        <Route path="/recordings" element={<RecordingsPage />} />
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="/account" element={<AccountPage />} />
        {user.role === 'admin' && <Route path="/admin/*" element={<AdminPage />} />}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      </Suspense>
    </Layout>
  )
}
