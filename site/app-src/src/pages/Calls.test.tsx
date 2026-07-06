// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

// mock api（数据源）+ useCall（避免引入 CallScreen→webrtc 的浏览器 API 链）；useI18n 默认 ctx(zh) 无需 Provider。
// 通话记录行经 CallHistoryRow 用 Link，mock 成 <a> 以断言链接。
vi.mock('react-router-dom', () => ({ Link: (p: { to: string; children: unknown }) => <a href={p.to}>{p.children as never}</a> }))
vi.mock('../lib/api', () => ({ api: { incomingCalls: vi.fn(), helpQueue: vi.fn(), callHistory: vi.fn() } }))
vi.mock('./call/CallController', () => ({ useCall: () => ({ answerIncoming: vi.fn(), claimQueue: vi.fn(), active: null }) }))
// 只 spy 提示音；pickNewHelpRequests 保持真实（新到判定的真逻辑要跑到）。
vi.mock('../lib/helpQueueAlert', async (orig) => ({ ...(await orig() as object), playHelpChime: vi.fn() }))
import { api } from '../lib/api'
import { playHelpChime } from '../lib/helpQueueAlert'
import { CallsPage, formatWaited } from './Calls'

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

  it('通话记录：对端仍在的整行链到聊天；已注销(peerId 缺失)不可点', async () => {
    mock(api.helpQueue).mockResolvedValue({ requests: [], count: 0 })
    mock(api.callHistory).mockResolvedValue({
      calls: [
        { id: 'h1', peerId: 'p1', peerName: '王医生', peerAvatar: null, direction: 'incoming', status: 'answered', createdAt: 1_700_000_000_000 },
        { id: 'h2', peerId: null, peerName: '已注销用户', peerAvatar: null, direction: 'outgoing', status: 'missed', createdAt: 1_700_000_000_000 },
      ],
    })
    render(<CallsPage />)
    const doctor = await screen.findByText('王医生')
    expect(doctor.closest('a')?.getAttribute('href')).toBe('/chat/p1') // 整行可点进聊天
    expect(screen.getByText('已注销用户').closest('a')).toBeNull()       // 已注销不可点
  })

  it('新求助进队时响提示音——首帧建基线不响、之后新到才响（此前 helpQueueAlert 已建却未接线）', async () => {
    vi.useFakeTimers()
    try {
      mock(api.incomingCalls).mockResolvedValue({ calls: [] })
      mock(api.callHistory).mockResolvedValue({ calls: [] })
      // 首帧：队列已有 c1（打开页面时你正看着它，不该突然响）。
      mock(api.helpQueue).mockResolvedValue({ requests: [{ callId: 'c1', fromName: 'A', waitedSeconds: 5 }], count: 1 })
      render(<CallsPage />)
      await vi.advanceTimersByTimeAsync(0) // 冲刷首帧 load 的微任务
      expect(playHelpChime).not.toHaveBeenCalled() // 首帧只建基线，不响
      // 新求助 c2 进队 → 下一轮轮询应响一次。
      mock(api.helpQueue).mockResolvedValue({ requests: [{ callId: 'c1', fromName: 'A', waitedSeconds: 9 }, { callId: 'c2', fromName: 'B', waitedSeconds: 2 }], count: 2 })
      await vi.advanceTimersByTimeAsync(4000)
      expect(playHelpChime).toHaveBeenCalledTimes(1) // 只 c2 是新到
      // 无新变化（仍是 c1+c2）→ 不重复响。
      await vi.advanceTimersByTimeAsync(4000)
      expect(playHelpChime).toHaveBeenCalledTimes(1)
    } finally {
      vi.useRealTimers()
    }
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

describe('formatWaited 等待时长格式（秒/分钟/小时）', () => {
  const t = (_z: string, e: string) => e
  it('<60s 报秒；<1h 报分钟；≥1h 报小时（长候不再显示难读的大分钟数）', () => {
    expect(formatWaited(45, t)).toBe('waited 45s')
    expect(formatWaited(90, t)).toBe('waited 1m')            // floor
    expect(formatWaited(3599, t)).toBe('waited 59m')
    expect(formatWaited(3600, t)).toBe('waited 1h')          // 整点小时无分钟后缀
    expect(formatWaited(5400, t)).toBe('waited 1h 30m')
    expect(formatWaited(4 * 3600, t)).toBe('waited 4h')      // 4 小时 TTL 满：不再是"240m"
  })
  it('非有限/负值兜底为 0（不显示 NaN）', () => {
    expect(formatWaited(NaN, t)).toBe('waited 0s')
    expect(formatWaited(-5, t)).toBe('waited 0s')
    expect(formatWaited(Infinity, t)).toBe('waited 0s')
  })
})
