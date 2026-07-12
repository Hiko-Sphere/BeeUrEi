import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import './index.css'
import { applyTheme, setLang, getLang } from './lib/theme'
import { I18nProvider } from './lib/i18n'
import { SessionProvider } from './lib/session'
import { ToastProvider } from './components/ui'
import { ErrorBoundary } from './components/ErrorBoundary'
import { registerServiceWorker } from './lib/webPush'
// 副作用 import：尽早挂 beforeinstallprompt 监听（事件在加载后很早派发，懒加载会错过）——
// 捕获后由账户页"安装为应用"卡呈现（已安装 PWA 才有图标角标：未接来电/未读的桌面级提示）。
import './lib/installPrompt'
import { App } from './App'

applyTheme()
setLang(getLang())
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', applyTheme)
// 启动即注册 SW（不涉通知权限）：所有协助者都获得离线兜底页，不只开了 Web Push 的人（见对抗复审）。
void registerServiceWorker()

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
