import { Component, type ReactNode } from 'react'
import { getLang } from '../lib/theme'

/// 全局错误边界：任何渲染错误、或懒加载 chunk 加载失败（尤其换版后旧 tab 引用的旧 hash chunk
/// 已不存在）都兜底成"出错了 + 刷新"，而非整页白屏。刷新通常拉到新 chunk/恢复状态即解决。
/// 放在 main.tsx 最外层（providers 之外），故用 getLang()（读 localStorage/navigator，不依赖 React ctx）选语言。
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: boolean }> {
  state = { error: false }
  static getDerivedStateFromError(): { error: boolean } { return { error: true } }
  componentDidCatch(err: unknown): void { console.error('[app] 未捕获错误:', err) }
  render(): ReactNode {
    if (!this.state.error) return this.props.children
    const zh = getLang() === 'zh'
    return (
      <div className="grid min-h-dvh place-items-center p-6 text-center" role="alert">
        <div>
          <p className="text-lg font-semibold">{zh ? '出错了' : 'Something went wrong'}</p>
          <p className="mt-1 text-sm text-faint">{zh ? '刷新通常能解决（尤其刚更新过版本时）。' : 'Reloading usually fixes it (especially right after an update).'}</p>
          <button onClick={() => location.reload()} className="mt-4 rounded-xl bg-honey px-5 py-2.5 text-sm font-semibold text-ink">{zh ? '刷新' : 'Reload'}</button>
        </div>
      </div>
    )
  }
}
