// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react'

// RecordingsPage 仅用 useI18n(默认 ctx)+useToast(no-op 默认)+api；fetchRecordingObjectURL 仅播放时调用，渲染不触及。
vi.mock('../lib/api', () => ({
  api: { myRecordings: vi.fn(), deleteMyRecording: vi.fn() },
  fetchRecordingObjectURL: vi.fn(),
  fetchRecordingBlob: vi.fn(),
  APIError: class extends Error { code = ''; status = 0 },
}))
import { api, fetchRecordingObjectURL, fetchRecordingBlob } from '../lib/api'
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

  it('录制原因(reason)非空时渲染、空时不显示（死字段修复：服务端下发 reason 但列表从不呈现；知情同意透明度）', async () => {
    mock(api.myRecordings).mockResolvedValue({
      recordings: [
        { id: 'r1', recordedAt: 1_700_000_000_000, hasMedia: true, participantNames: ['张三'], reason: '与房东的纠纷取证' },
        { id: 'r2', recordedAt: 1_700_000_000_001, hasMedia: true, participantNames: ['李四'], reason: '' }, // 空原因不出标签
      ],
    })
    render(<RecordingsPage />)
    expect(await screen.findByText(/与房东的纠纷取证/)).toBeInTheDocument()
    // 恰一个"录制原因"标签（r1 有、r2 空原因不显示）。
    expect(screen.getAllByText(/录制原因/)).toHaveLength(1)
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

describe('RecordingsPage 下载录音（数据可携权的媒体通道）', () => {
  beforeEach(() => vi.clearAllMocks())

  it('点"下载"→ 取 Blob、按 MIME 推扩展名(.webm)、文件名带录制时刻、objectURL 用后即 revoke', async () => {
    mock(api.myRecordings).mockResolvedValue({
      recordings: [{ id: 'r1', recordedAt: Date.UTC(2026, 0, 5, 9, 30), durationSec: 10, hasMedia: true, participantNames: ['张三'], reason: '' }],
    })
    mock(fetchRecordingBlob).mockResolvedValue(new Blob(['x'], { type: 'video/webm' }))
    const createURL = vi.fn(() => 'blob:dl')
    const revokeURL = vi.fn()
    vi.stubGlobal('URL', Object.assign(Object.create(URL), { createObjectURL: createURL, revokeObjectURL: revokeURL }))
    const names: string[] = []
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) { names.push(this.download) })
    try {
      render(<RecordingsPage />)
      fireEvent.click(await screen.findByRole('button', { name: '下载录音' }))
      await waitFor(() => expect(fetchRecordingBlob).toHaveBeenCalledWith('r1'))
      await waitFor(() => expect(names.length).toBe(1))
      expect(names[0]).toMatch(/^beeurei-recording-2026\d{4}-\d{4}\.webm$/) // MIME→.webm，文件名带日期时刻
      expect(createURL).toHaveBeenCalled()
      expect(revokeURL).toHaveBeenCalledWith('blob:dl') // 用后即 revoke，不泄漏
    } finally { clickSpy.mockRestore(); vi.unstubAllGlobals() }
  })

  it('无媒体的录制：下载按钮禁用（不发无意义请求）', async () => {
    mock(api.myRecordings).mockResolvedValue({
      recordings: [{ id: 'r2', recordedAt: 1_700_000_000_000, hasMedia: false, participantNames: ['张三'], reason: '' }],
    })
    render(<RecordingsPage />)
    expect(await screen.findByRole('button', { name: '下载录音' })).toBeDisabled()
    expect(fetchRecordingBlob).not.toHaveBeenCalled()
  })
})
