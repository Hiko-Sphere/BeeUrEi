// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

// RecordingsPage 仅用 useI18n(默认 ctx)+useToast(no-op 默认)+api；fetchRecordingObjectURL 仅播放时调用，渲染不触及。
vi.mock('../lib/api', () => ({
  api: { myRecordings: vi.fn(), deleteMyRecording: vi.fn() },
  fetchRecordingObjectURL: vi.fn(),
  APIError: class extends Error { code = ''; status = 0 },
}))
import { api } from '../lib/api'
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

  it('空列表 → 空态文案', async () => {
    mock(api.myRecordings).mockResolvedValue({ recordings: [] })
    render(<RecordingsPage />)
    expect(await screen.findByText('暂无录音')).toBeInTheDocument()
  })
})
