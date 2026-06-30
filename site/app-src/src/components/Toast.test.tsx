// @vitest-environment jsdom
import { useEffect } from 'react'
import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ToastProvider, useToast } from './ui'

// 触发 toast 的小组件：挂载后推一条指定 tone 的消息（useEffect 一次性，非 StrictMode 不重复）。
function Trigger({ text, tone }: { text: string; tone?: 'info' | 'ok' | 'error' }) {
  const toast = useToast()
  useEffect(() => { toast(text, tone) }, [toast, text, tone])
  return null
}

describe('Toast 无障碍角色（读屏可听到反馈）', () => {
  it('error 调子用 role=alert（assertive 打断）', async () => {
    render(<ToastProvider><Trigger text="内容被禁止，未发送" tone="error" /></ToastProvider>)
    expect(await screen.findByRole('alert')).toHaveTextContent('内容被禁止，未发送')
  })

  it('非 error 调子用 role=status（polite）', async () => {
    render(<ToastProvider><Trigger text="群已创建" tone="ok" /></ToastProvider>)
    expect(await screen.findByRole('status')).toHaveTextContent('群已创建')
  })
})
