// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'

// RecordingsPage 仅用 useI18n(默认 ctx)+useToast(no-op 默认)+api；fetchRecordingObjectURL 仅播放时调用，渲染不触及。
vi.mock('../lib/api', () => ({
  api: { myRecordings: vi.fn(), deleteMyRecording: vi.fn() },
  fetchRecordingObjectURL: vi.fn(),
  APIError: class extends Error { code = ''; status = 0 },
}))
import { api, fetchRecordingObjectURL } from '../lib/api'
import { RecordingsPage } from './Recordings'

const mock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

describe('RecordingsPage 列表渲染（防字段漂移）', () => {
  beforeEach(() => vi.clearAllMocks())

  it('锁定 durationSec/hasMedia/participantNames/locationLabel 渲染键', async () => {
    mock(api.myRecordings).mockResolvedValue({
      recordings: [{ id: 'r1', recordedAt: 1_700_000_000_000, durationSec: 125, hasMedia: true, participantNames: ['张三', '李四'], locationLabel: '上海市黄浦区' }],
    })
    render(<RecordingsPage />)
    expect(await screen.findByText('2:05')).toBeInTheDocument()       // fmtDuration(125) = 2:05
    expect(screen.getByText('可播放')).toBeInTheDocument()            // hasMedia=true
    expect(screen.getByText(/张三、李四/)).toBeInTheDocument()        // participantNames 顿号连接
    expect(screen.getByText(/上海市黄浦区/)).toBeInTheDocument()      // locationLabel
  })

  it('无媒体 → "无媒体" + 播放按钮禁用 + 参与者空显示"—"', async () => {
    mock(api.myRecordings).mockResolvedValue({
      recordings: [{ id: 'r2', recordedAt: 1_700_000_000_000, hasMedia: false, participantNames: [] }],
    })
    render(<RecordingsPage />)
    expect(await screen.findByText('无媒体')).toBeInTheDocument()
    expect(screen.getByText('—')).toBeInTheDocument()                 // 空参与者兜底
    expect(screen.getByRole('button', { name: /播放/ })).toBeDisabled()
  })

  it('回放弹窗无障碍：role=dialog + aria-modal，Esc 关闭', async () => {
    mock(api.myRecordings).mockResolvedValue({
      recordings: [{ id: 'r1', recordedAt: 1_700_000_000_000, durationSec: 10, hasMedia: true, participantNames: ['张三'] }],
    })
    mock(fetchRecordingObjectURL).mockResolvedValue('blob:play');
    (globalThis.URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = vi.fn()
    render(<RecordingsPage />)
    await screen.findByText('张三')                                       // 等录音列表渲染
    fireEvent.click(screen.getByRole('button', { name: /播放/ }))
    const dialog = await screen.findByRole('dialog')                      // 回放弹窗
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    // Esc 关闭弹窗。
    fireEvent.keyDown(document, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  it('空列表 → 空态文案', async () => {
    mock(api.myRecordings).mockResolvedValue({ recordings: [] })
    render(<RecordingsPage />)
    expect(await screen.findByText('暂无录音')).toBeInTheDocument()
  })

  it('播放请求在途时卸载 → 就地释放已建的 blob URL（不泄漏，复审 LOW）', async () => {
    mock(api.myRecordings).mockResolvedValue({
      recordings: [{ id: 'r1', recordedAt: 1_700_000_000_000, durationSec: 10, hasMedia: true, participantNames: [] }],
    })
    let resolveFetch: (u: string) => void = () => {}
    mock(fetchRecordingObjectURL).mockReturnValue(new Promise((r) => { resolveFetch = r }))
    const revoke = vi.fn();
    (globalThis.URL as unknown as { revokeObjectURL: (u: string) => void }).revokeObjectURL = revoke
    const { unmount } = render(<RecordingsPage />)
    fireEvent.click(await screen.findByRole('button', { name: /播放/ })) // play() 开始 await fetch
    unmount()                                                            // 在途卸载
    await act(async () => { resolveFetch('blob:leak'); await Promise.resolve(); await Promise.resolve() })
    expect(revoke).toHaveBeenCalledWith('blob:leak')                     // 未挂载→就地 revoke，不泄漏
  })
})
