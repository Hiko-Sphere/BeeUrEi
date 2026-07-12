import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useSession } from './lib/session'
import { Spinner } from './components/ui'
import { LoginPage } from './pages/Login'
import { Layout } from './components/Layout'
import { HomePage } from './pages/Home'
import { CallsPage } from './pages/Calls'
import { NotificationsPage } from './pages/Notifications'
// 紧急/通话关键路径保持 eager（Home 的 SOS 横幅、Calls 应答、Notifications 的告警列表 + 全局
// IncomingCall/EmergencyAlert/HelpQueue host 都在主包，随首屏即时可用）。其余大页（Chat 900+ 行、
// Family、Recordings）非即时响应路径，懒加载出主包——缩小首屏解析、加快到可交互，尤其协助者收到
// SOS 时越快看到并响应越好。importWithReload 同 Locations/Admin/Routes：陈旧 chunk 自愈。
// Account（870 行）也懒加载：VerificationDialog 已抽到独立 components/VerificationDialog（eager 的
// VerificationGate 改引它），Account 不再被 eager 图可达，故真能拆出主包。
const ChatPage = lazy(importWithReload(() => import('./pages/Chat').then((m) => ({ default: m.ChatPage }))))
const FamilyPage = lazy(importWithReload(() => import('./pages/Family').then((m) => ({ default: m.FamilyPage }))))
const RecordingsPage = lazy(importWithReload(() => import('./pages/Recordings').then((m) => ({ default: m.RecordingsPage }))))
const AccountPage = lazy(importWithReload(() => import('./pages/Account').then((m) => ({ default: m.AccountPage }))))
import { IncomingCallHost } from './pages/call/IncomingCallHost'
import { EmergencyAlertHost } from './pages/call/EmergencyAlertHost'
import { HelpQueueAlertHost } from './pages/call/HelpQueueAlertHost'
import { VerificationGate } from './pages/VerificationGate'
import { importWithReload } from './lib/lazyReload'

// 懒加载重/少用页，缩小首屏主包：Locations 带 Leaflet 地图库(~140KB)、Admin 仅管理员可达。
// 其余为核心页（多数会话都用），保持 eager 避免每次导航闪烁。
// importWithReload：部署替换哈希 chunk 后，旧标签页首次点开这些页会 404——自动整页刷新一次自愈
// （同会话第二次仍败=真网络故障，抛给 ErrorBoundary，绝不无限刷）。
const LocationsPage = lazy(importWithReload(() => import('./pages/Locations').then((m) => ({ default: m.LocationsPage }))))
const AdminPage = lazy(importWithReload(() => import('./pages/Admin').then((m) => ({ default: m.AdminPage }))))
const RoutesPage = lazy(importWithReload(() => import('./pages/Routes').then((m) => ({ default: m.RoutesPage })))) // 带 Leaflet，与 Locations 同策略懒加载

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
      <HelpQueueAlertHost />
      <Suspense fallback={<Spinner />}>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/calls" element={<CallsPage />} />
        <Route path="/chat" element={<ChatPage />} />
        <Route path="/chat/g/:groupId" element={<ChatPage />} /> {/* 群深链（web push 点开直达该群）；须在 /chat/:peerId 之前，避免 'g' 被当 peerId */}
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
