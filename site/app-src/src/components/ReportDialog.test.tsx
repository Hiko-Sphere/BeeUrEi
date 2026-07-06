// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// 举报弹窗：可从**通话**（带 callId + 加好友/拉黑 + 可附录制）或**联系人**（仅 targetUserId + 理由）发起。
// 走共享无障碍 Modal（role=dialog / aria-modal / Esc 关闭）。
vi.mock('../lib/api', () => ({
  api: { report: vi.fn() },
  callErrorText: () => 'err',
  APIError: class extends Error { code = ''; status = 0 },
}))
import { api } from '../lib/api'
import { ReportDialog } from './ReportDialog'

describe('ReportDialog 举报弹窗', () => {
  beforeEach(() => vi.clearAllMocks())

  it('无障碍：role=dialog + aria-modal，Esc 关闭调 onClose', async () => {
    const onClose = vi.fn()
    render(<ReportDialog targetUserId="u1" callId="c1" evidenceRecordingId={null} onClose={onClose} onAddFriend={vi.fn()} onBlock={vi.fn()} />)
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(dialog).toHaveAttribute('aria-label') // 弹窗有名（读屏可播报）
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })

  it('联系人模式（无 callId、无加好友/拉黑回调）：不渲染通话专属按钮，提交只带 targetUserId+理由', async () => {
    const onClose = vi.fn()
    render(<ReportDialog targetUserId="u9" onClose={onClose} />)
    // 通话专属按钮不出现（用双语正则，确保是"真没渲染"而非只是语言不符而漏判）。
    expect(screen.queryByText(/加为联系人|Add contact/)).toBeNull()
    expect(screen.queryByText(/拉黑|Block/)).toBeNull()
    // 填理由 + 提交 → api.report(targetUserId, reason, callId=undefined, evidence=undefined)。
    fireEvent.change(screen.getByPlaceholderText(/请描述问题|Describe the issue/), { target: { value: '骚扰' } })
    fireEvent.click(screen.getByText(/提交举报|Submit report/))
    await waitFor(() => expect(api.report).toHaveBeenCalledWith('u9', '骚扰', undefined, undefined))
    await waitFor(() => expect(onClose).toHaveBeenCalled())
  })
})
