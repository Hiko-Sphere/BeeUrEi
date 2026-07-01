// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

// mock api（数据源）+ useCall（避免引入 CallScreen→webrtc 的浏览器 API 链）；useI18n 默认 ctx(zh) 无需 Provider。
vi.mock('../lib/api', () => ({ api: { incomingCalls: vi.fn(), helpQueue: vi.fn(), callHistory: vi.fn() } }))
vi.mock('./call/CallController', () => ({ useCall: () => ({ answerIncoming: vi.fn(), claimQueue: vi.fn(), active: null }) }))
import { api } from '../lib/api'
import { CallsPage } from './Calls'

const mock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

describe('CallsPage 公开求助队列渲染（防字段漂移复发）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mock(api.incomingCalls).mockResolvedValue({ calls: [] })
    mock(api.callHistory).mockResolvedValue({ calls: [] })
  })

  it('渲染 fromName/主题/地点/已等待时长；语言与本端一致时高亮"你的语言"', async () => {
    mock(api.helpQueue).mockResolvedValue({
      requests: [{ callId: 'c1', fromName: '小明', topic: '帮我看红绿灯', language: 'zh', locality: '上海市', waitedSeconds: 120 }],
      count: 1,
    })
    render(<CallsPage />)
    expect(await screen.findByText('小明')).toBeInTheDocument()
    expect(screen.getByText('帮我看红绿灯')).toBeInTheDocument()   // topic
    expect(screen.getByText('上海市')).toBeInTheDocument()         // locality
    expect(screen.getByText(/已等待 2 分钟/)).toBeInTheDocument()  // waitedSeconds=120 → 2 分钟
    expect(screen.getByText(/你的语言/)).toBeInTheDocument()       // language=zh 与默认 ctx(zh) 匹配 → 高亮
  })

  it('语言不一致时不高亮"你的语言"，仍显示语言标签', async () => {
    mock(api.helpQueue).mockResolvedValue({
      requests: [{ callId: 'c2', fromName: 'Tom', language: 'en', waitedSeconds: 30 }],
      count: 1,
    })
    render(<CallsPage />)
    expect(await screen.findByText('Tom')).toBeInTheDocument()
    expect(screen.getByText('EN')).toBeInTheDocument()             // 语言标签仍显示
    expect(screen.queryByText(/你的语言/)).toBeNull()              // en ≠ zh → 不高亮
    expect(screen.getByText(/已等待 30 秒/)).toBeInTheDocument()
  })

  it('某段端点持续失败也退出加载态（显示空态，而非永远转圈）', async () => {
    mock(api.incomingCalls).mockResolvedValue({ calls: [] })
    mock(api.helpQueue).mockResolvedValue({ requests: [] })
    mock(api.callHistory).mockRejectedValue(new Error('boom')) // 历史段拉取失败
    render(<CallsPage />)
    // 历史段应落到空态"暂无记录"，而不是卡在 Spinner
    expect(await screen.findByText('暂无记录')).toBeInTheDocument()
  })
})
