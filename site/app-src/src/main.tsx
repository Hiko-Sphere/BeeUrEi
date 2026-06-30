import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import { applyTheme, setLang, getLang } from './lib/theme'
import { I18nProvider } from './lib/i18n'
import { SessionProvider } from './lib/session'
import { ToastProvider } from './components/ui'
import { ErrorBoundary } from './components/ErrorBoundary'
import { App } from './App'

applyTheme()
setLang(getLang())
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme)

// 不用 StrictMode：本应用大量使用 WebRTC/WebSocket，StrictMode 在开发期的双挂载会造成
// 信令双连接与 PeerConnection 重复创建，干扰联调。生产无双挂载，去掉即可避免开发幻象。
createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <BrowserRouter basename="/app">
      <I18nProvider>
        <SessionProvider>
          <ToastProvider>
            <App />
          </ToastProvider>
        </SessionProvider>
      </I18nProvider>
    </BrowserRouter>
  </ErrorBoundary>,
)
