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

  it('录制地点：有坐标→可点 Apple Maps 链接（死字段修复：lat/lon 此前未用）；有坐标无标签→显"查看位置"链接；无坐标有标签→纯文本；都无→不显', async () => {
    mock(api.myRecordings).mockResolvedValue({
      recordings: [
        { id: 'r1', recordedAt: 1_700_000_000_000, hasMedia: true, participantNames: ['甲'], lat: 31.23, lon: 121.47, locationLabel: '上海市黄浦区' }, // 坐标+标签→链接带标签文本
        { id: 'r2', recordedAt: 1_700_000_000_001, hasMedia: true, participantNames: ['乙'], lat: 39.9, lon: 116.4 },                                   // 坐标无标签→"查看位置"链接（此前整条不显）
        { id: 'r3', recordedAt: 1_700_000_000_002, hasMedia: true, participantNames: ['丙'], locationLabel: '成都市' },                                   // 无坐标有标签→纯文本、无链接
        { id: 'r4', recordedAt: 1_700_000_000_003, hasMedia: true, participantNames: ['丁'], lat: 999, lon: 0, locationLabel: '越界坐标' },              // 坐标越界→退回纯文本（不拼坏链）
      ],
    })
    render(<RecordingsPage />)
    await screen.findByText('甲')
    // r1：标签作链接文本，href 指向 Apple Maps（坐标 + 编码后的标签查询名）。
    const link1 = screen.getByRole('link', { name: /上海市黄浦区/ })
    expect(link1).toHaveAttribute('href', `https://maps.apple.com/?ll=31.23,121.47&q=${encodeURIComponent('上海市黄浦区')}`)
    // r2：有坐标无标签 → "查看位置"链接（此前 locationLabel 缺失时整条位置不显，坐标白白浪费）。
    const link2 = screen.getByRole('link', { name: /查看位置/ })
    expect(link2).toHaveAttribute('href', 'https://maps.apple.com/?ll=39.9,116.4&q=39.9,116.4')
    // r3：无坐标有标签 → 纯文本呈现、不是链接。
    expect(screen.getByText(/成都市/)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /成都市/ })).toBeNull()
    // r4：坐标越界 → validLatLng 挡下，退回纯文本标签、绝不渲染坏链接。
    expect(screen.getByText(/越界坐标/)).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /越界坐标/ })).toBeNull()
    expect(screen.getAllByRole('link', { name: /查看位置|上海市黄浦区/ })).toHaveLength(2) // 恰两条有效坐标出链接
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

  it('点"下载"→ 取 Blob、按 MIME 推扩展名(.webm)、文件名带录制时刻；objectURL **延迟**释放（不同步 revoke——避免"另存为"对话框/异步下载读到已失效 URL 致空文件）', async () => {
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
      const btn = await screen.findByRole('button', { name: '下载录音' }) // 列表加载用真实计时器
      vi.useFakeTimers()
      fireEvent.click(btn)
      // flush 取 Blob 的 await 链（Promise 微任务，默认不被 fake timers 影响）→ 同步体建 URL + a.click + 安排延迟 revoke。
      await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve() })
      expect(fetchRecordingBlob).toHaveBeenCalledWith('r1')
      expect(names.length).toBe(1)
      expect(names[0]).toMatch(/^beeurei-recording-2026\d{4}-\d{4}\.webm$/) // MIME→.webm，文件名带日期时刻
      expect(createURL).toHaveBeenCalled()
      expect(revokeURL).not.toHaveBeenCalled()          // 回归护栏：**绝不同步 revoke**（否则下载可能读到已失效 URL）
      vi.advanceTimersByTime(60_000)                      // 延迟到点
      expect(revokeURL).toHaveBeenCalledWith('blob:dl')  // 才释放，不泄漏
    } finally { clickSpy.mockRestore(); vi.useRealTimers(); vi.unstubAllGlobals() }
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
