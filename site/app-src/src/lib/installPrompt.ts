/// PWA 安装提示捕获（Chromium 系专用事件）：浏览器在满足可安装条件时派发 beforeinstallprompt——
/// **不拦截就会被默认地址栏小图标埋没**，且事件常在页面加载后很早派发，监听必须随首包尽早挂
/// （由 main.tsx 顶部 import 本模块的副作用完成；懒加载会错过事件）。
///
/// 为什么值得请协助者安装：图标角标（未接来电/未读，Badging API）**只在已安装的 PWA 生效**，
/// 长开标签页之外多一层"有人找我"的可见提示；独立窗口/主屏图标也更快唤起。
/// 能力门控诚实：Safari/iOS/Firefox 无此事件 → installAvailable() 恒 false，安装卡不渲染（绝不给假按钮）。
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

let deferred: BeforeInstallPromptEvent | null = null
const listeners = new Set<() => void>()
const notify = () => { for (const cb of listeners) cb() }

if (typeof window !== 'undefined') {
  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault() // 拦下默认迷你信息栏，改由我们的安装卡在用户可发现处呈现
    deferred = e as BeforeInstallPromptEvent
    notify()
  })
  // 安装完成（无论经我们的按钮还是浏览器菜单）：清掉暂存，安装卡随之消失。
  window.addEventListener('appinstalled', () => { deferred = null; notify() })
}

export function installAvailable(): boolean { return deferred !== null }

/// 弹出浏览器原生安装确认。用户拒绝后浏览器不会再派发事件（本次会话不可重试）——如实返回结果，
/// 调用方据此收起卡片/提示，绝不假装还能再装。
export async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
  const ev = deferred
  if (!ev) return 'unavailable'
  deferred = null // prompt() 只能调一次：先清暂存（无论结果），防二次调用抛异常
  notify()
  try {
    await ev.prompt()
    return (await ev.userChoice).outcome
  } catch { return 'unavailable' }
}

/// 订阅可安装状态变化（事件晚于组件挂载到达时刷新 UI）。返回退订函数。
export function onInstallAvailable(cb: () => void): () => void {
  listeners.add(cb)
  return () => listeners.delete(cb)
}
