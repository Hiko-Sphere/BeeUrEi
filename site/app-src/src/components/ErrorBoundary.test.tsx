// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ErrorBoundary } from './ErrorBoundary'

function Boom(): never { throw new Error('boom') }

describe('ErrorBoundary', () => {
  afterEach(() => vi.restoreAllMocks())

  it('正常子组件直通', () => {
    render(<ErrorBoundary><p>正常内容</p></ErrorBoundary>)
    expect(screen.getByText('正常内容')).toBeInTheDocument()
  })

  it('子组件抛错 → 兜底为 role=alert + 刷新按钮（不白屏）', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {}) // 抑制 React 的错误堆栈噪音
    render(<ErrorBoundary><Boom /></ErrorBoundary>)
    expect(screen.getByRole('alert')).toBeInTheDocument()           // 读屏可感知
    expect(screen.getByRole('button', { name: /刷新|Reload/ })).toBeInTheDocument()
  })
})
