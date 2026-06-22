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
import { AdminPage } from './pages/Admin'
import { IncomingCallHost } from './pages/call/IncomingCallHost'

export function App() {
  const { user, ready } = useSession()
  if (!ready) return <div className="grid min-h-dvh place-items-center"><Spinner /></div>
  if (!user) {
    return (
      <Routes>
        <Route path="*" element={<LoginPage />} />
      </Routes>
    )
  }
  return (
    <Layout>
      <IncomingCallHost />
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/calls" element={<CallsPage />} />
        <Route path="/chat" element={<ChatPage />} />
        <Route path="/chat/:peerId" element={<ChatPage />} />
        <Route path="/family" element={<FamilyPage />} />
        <Route path="/recordings" element={<RecordingsPage />} />
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="/account" element={<AccountPage />} />
        {user.role === 'admin' && <Route path="/admin/*" element={<AdminPage />} />}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Layout>
  )
}
