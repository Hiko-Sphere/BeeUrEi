// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// 通话中「举报与安全」弹窗此前走 CallScreen 里一个无 a11y 的本地 Modal（无 role/Esc/焦点）；
// 改走共享无障碍 Modal 后应为可达对话框、可 Esc 关闭。
vi.mock('../../lib/api', () => ({
  api: { report: vi.fn() },
  callErrorText: () => 'err',
  APIError: class extends Error { code = ''; status = 0 },
}))
import { ReportDialog } from './CallScreen'

describe('通话中举报弹窗无障碍', () => {
  beforeEach(() => vi.clearAllMocks())

  it('role=dialog + aria-modal，Esc 关闭调 onClose', async () => {
    const onClose = vi.fn()
    render(<ReportDialog targetUserId="u1" callId="c1" evidenceRecordingId={null} onClose={onClose} onAddFriend={vi.fn()} onBlock={vi.fn()} />)
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAttribute('aria-label') // 弹窗有名（读屏可播报）
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })
})
