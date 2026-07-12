// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { axeViolations } from '../lib/axeCheck'

/// 录音页无障碍门禁：Recordings 是协助者/家人**回看通话录制**页（知情同意留存的证据、位置、参与者，
/// 每条带 播放/下载/删除 三个图标操作）。服务视障用户的亲友（本身也可能有障碍）——图标操作无可访问名、
/// 或删除按钮无区分（多条同名"删除"）会让读屏亲友无法回看/管理录音。此前不在 axe 门禁内，回归须挡在合并前。
/// axe 配置见 lib/axeCheck.ts（color-contrast/region 因 jsdom 限制禁用，其余全效）。

vi.mock('../lib/download', () => ({ saveBlob: vi.fn() }))
vi.mock('../lib/api', () => ({
  api: { myRecordings: vi.fn(), deleteMyRecording: vi.fn() },
  fetchRecordingObjectURL: vi.fn(),
  fetchRecordingBlob: vi.fn(),
  APIError: class extends Error {},
}))
import { api } from '../lib/api'
import { RecordingsPage } from './Recordings'

const mock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

describe('Recordings 页无障碍门禁（axe 0 violations）', () => {
  it('有媒体+地点+原因+参与者 与 无媒体 两类录音卡：图标操作均有可访问名，0 violations', async () => {
    mock(api.myRecordings).mockResolvedValue({ recordings: [
      { id: 'r1', callId: 'c1', ownerId: 'me', ownerName: '我', reason: '过马路协助',
        recordedAt: Date.now() - 60000, durationSec: 125, lat: 31.23, lon: 121.47, locationLabel: '南京西路',
        participantIds: ['me', 'u2'], participantNames: ['我', '志愿者小张'], hasMedia: true },
      { id: 'r2', callId: 'c2', ownerId: 'me', ownerName: '我', reason: '',
        recordedAt: Date.now() - 3600000, durationSec: null, lat: null, lon: null, locationLabel: null,
        participantIds: ['me', 'u3'], participantNames: ['我', '女儿'], hasMedia: false, deletedAt: Date.now() - 1000 },
    ] })
    const { container } = render(<RecordingsPage />)
    await screen.findByText('过马路协助')
    expect(await axeViolations(container)).toEqual([])
  })

  it('空态（无录音）也 0 violations', async () => {
    mock(api.myRecordings).mockResolvedValue({ recordings: [] })
    const { container } = render(<RecordingsPage />)
    await new Promise((r) => setTimeout(r, 0))
    expect(await axeViolations(container)).toEqual([])
  })
})
