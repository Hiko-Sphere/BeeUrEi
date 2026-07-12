// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'

/// LocationsPage（实时位置共享）——曾 0% 覆盖的安全功能页。页内布满历史复审 HIGH 不变量
///（停止清陈旧坐标防旧位置泄漏/滞后 publish 不复活/断网停滞警示/定时自动停/403 拆除），
/// 此前全部无测试。Leaflet 桩化（本库惯例，见 Routes.test）：地图互操作非被测点，
/// 被测的是**共享生命周期与上报语义**（api 调用即服务端可见行为）。
const chain = () => {
  const o: Record<string, ReturnType<typeof vi.fn>> = {}
  const h = new Proxy(o, { get: (t, k: string) => (t[k] ??= vi.fn(() => h)) })
  return h as never
}
vi.mock('leaflet', () => ({ default: new Proxy({}, { get: () => vi.fn(() => chain()) }) }))
vi.mock('leaflet/dist/leaflet.css', () => ({}))
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }))
vi.mock('../lib/session', () => ({ useSession: () => ({ user: { id: 'me', displayName: '阿明', role: 'blind' } }) }))
vi.mock('./call/CallController', () => ({ useCall: () => ({ startOutgoing: vi.fn(), active: null }) }))
// 两个自带 api 依赖的子组件各有专测；此处聚焦共享生命周期。
vi.mock('../components/RequestShareList', () => ({ RequestShareList: () => null }))
vi.mock('../components/SavedPlaces', () => ({ SavedPlaces: () => null }))
vi.mock('../lib/api', () => ({
  api: { contactLocations: vi.fn(), updateLocation: vi.fn(), stopSharingLocation: vi.fn() },
  APIError: class extends Error {
    code: string
    status: number
    constructor(code: string, status: number) { super(code); this.code = code; this.status = status }
  },
}))
import { api, APIError } from '../lib/api'
import { LocationsPage } from './Locations'

const mock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

// jsdom 无 geolocation：手写可控桩，测试里推真实坐标进 watchPosition 回调。
let geoCb: { success: ((p: { coords: Record<string, number | null> }) => void) | null } = { success: null }
const watchPosition = vi.fn((s: never) => { geoCb.success = s as never; return 7 })
const clearWatch = vi.fn()

const pushFix = (lat: number, lng: number, accuracy = 12) =>
  act(() => { geoCb.success?.({ coords: { latitude: lat, longitude: lng, accuracy, heading: null, altitude: null, speed: null } }) })

const flush = async (ms: number) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms) }) }

beforeEach(() => {
  vi.clearAllMocks()
  vi.useFakeTimers()
  geoCb = { success: null }
  Object.defineProperty(navigator, 'geolocation', { value: { watchPosition, clearWatch }, configurable: true })
  mock(api.contactLocations).mockResolvedValue({ contacts: [], sharing: false })
  mock(api.updateLocation).mockResolvedValue({})
  mock(api.stopSharingLocation).mockResolvedValue({})
})
afterEach(() => { vi.useRealTimers() })

describe('LocationsPage 共享生命周期（安全不变量）', () => {
  it('开始共享 → 定位到达 → 周期上报真实坐标（accuracy 一并送达；无截止不传 ttlSec）', async () => {
    render(<LocationsPage />)
    await flush(0)
    fireEvent.click(screen.getByRole('button', { name: /开始共享/ }))
    expect(watchPosition).toHaveBeenCalledTimes(1)
    pushFix(31.2304, 121.4737, 25)
    await flush(8000) // PUBLISH_MS
    expect(api.updateLocation).toHaveBeenCalledWith(expect.objectContaining({ lat: 31.2304, lng: 121.4737, accuracy: 25 }))
    expect(mock(api.updateLocation).mock.calls.at(-1)![0].ttlSec).toBeUndefined() // 「直到我停止」→ 不传 ttl
    expect(screen.getByText('正在共享你的位置')).toBeInTheDocument()
    expect(screen.getByText('直到你手动停止')).toBeInTheDocument()
  })

  it('停止共享 → 服务端停止 + 撤销 watch；再次开始时**新定位到达前绝不上报旧坐标**（隐私 HIGH）', async () => {
    render(<LocationsPage />)
    await flush(0)
    fireEvent.click(screen.getByRole('button', { name: /开始共享/ }))
    pushFix(31.2, 121.4)
    await flush(8000)
    const callsAfterFirstLeg = mock(api.updateLocation).mock.calls.length
    expect(callsAfterFirstLeg).toBeGreaterThan(0)

    fireEvent.click(screen.getByRole('button', { name: /停止共享/ }))
    expect(api.stopSharingLocation).toHaveBeenCalledTimes(1)
    expect(clearWatch).toHaveBeenCalledWith(7)
    expect(screen.getByText('未共享')).toBeInTheDocument()

    // 第二段行程：开始后旧坐标必须已被清——推进多个上报周期，无新定位就不得有任何上报。
    fireEvent.click(screen.getByRole('button', { name: /开始共享/ }))
    await flush(24000)
    expect(mock(api.updateLocation).mock.calls.length, '把上一段行程的旧位置当实时位置广播=隐私泄漏').toBe(callsAfterFirstLeg)
    // 新定位到达后恢复上报。
    pushFix(31.3, 121.5)
    await flush(8000)
    expect(mock(api.updateLocation).mock.calls.length).toBeGreaterThan(callsAfterFirstLeg)
  })

  it('停止后滞后返回的 publish 不复活共享（activeRef 守卫）：await 期间点了停止 → UI 保持未共享', async () => {
    let resolveInflight: (() => void) | null = null
    mock(api.updateLocation).mockImplementation(() => new Promise<void>((r) => { resolveInflight = () => r() }))
    render(<LocationsPage />)
    await flush(0)
    fireEvent.click(screen.getByRole('button', { name: /开始共享/ }))
    // 轮询会用服务端真相覆盖本地 sharing——开始后让 /contacts 如实返回 sharing:true，隔离被测的 activeRef 语义。
    mock(api.contactLocations).mockResolvedValue({ contacts: [], sharing: true })
    pushFix(31.2, 121.4)
    await flush(8000) // 发起上报，悬在途中
    expect(resolveInflight).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /停止共享/ }))
    expect(screen.getByText('未共享')).toBeInTheDocument()
    await act(async () => { resolveInflight!() }) // 在途上报此刻才成功返回
    expect(screen.getByText('未共享')).toBeInTheDocument() // 滞后成功不得把状态改回"共享中"
    expect(screen.queryByText('正在共享你的位置')).toBeNull()
  })

  it('断网停滞警示：>30s 无一次成功上报 → role=alert 如实告知"联系人可能看不到你"', async () => {
    mock(api.updateLocation).mockRejectedValue(new Error('offline'))
    render(<LocationsPage />)
    await flush(0)
    fireEvent.click(screen.getByRole('button', { name: /开始共享/ }))
    // 停滞场景=纯断网：poll 也一起失败（同一张网），绝不会用 sharing:false 把 UI 翻回未共享。
    mock(api.contactLocations).mockRejectedValue(new Error('offline'))
    pushFix(31.2, 121.4)
    await flush(16000) // 30s 内：还不该警（避免误报）
    expect(screen.queryByRole('alert')).toBeNull()
    await flush(24000) // 累计 40s 全失败 → 必须浮现（联系人端 90s 即被剔除，警示须先于消失出现）
    expect(screen.getByRole('alert').textContent).toMatch(/位置更新未能送达/)
  })

  it('定时共享：选 15 分钟 → 上报携 ttlSec 且到点自动停（用户不必记得关）', async () => {
    render(<LocationsPage />)
    await flush(0)
    fireEvent.change(screen.getByLabelText('共享时长'), { target: { value: '900' } })
    fireEvent.click(screen.getByRole('button', { name: /开始共享/ }))
    expect(screen.getByText(/将于 .+ 自动停止/)).toBeInTheDocument()
    pushFix(31.2, 121.4)
    await flush(8000)
    const ttl = mock(api.updateLocation).mock.calls.at(-1)![0].ttlSec
    expect(ttl).toBeGreaterThan(0)
    expect(ttl).toBeLessThanOrEqual(900) // ttl 贴近真实剩余：崩溃/关页后服务端很快过期
    await flush(900_000)
    expect(api.stopSharingLocation).toHaveBeenCalled() // 到点自动停
    expect(screen.getByText('未共享')).toBeInTheDocument()
  })

  it('管理员停用（403）→ 空态说明 + 拆除采集上报（不持续刷 403）', async () => {
    mock(api.contactLocations).mockRejectedValue(new APIError('feature_disabled', 403))
    render(<LocationsPage />)
    await flush(0)
    expect(screen.getByText('位置共享已关闭')).toBeInTheDocument()
    expect(screen.getByText('管理员已停用该功能')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /开始共享/ })).toBeNull() // 开关整块不渲染
  })

  it('联系人列表：显示在共享的联系人与计数；空态文案', async () => {
    mock(api.contactLocations).mockResolvedValue({ sharing: false, contacts: [
      { userId: 'c1', displayName: '女儿', role: 'helper', lat: 31.2, lng: 121.4, accuracy: 20, battery: 55, heading: null, updatedAt: Date.now() - 5000, avatar: null },
      { userId: 'c2', displayName: '志愿者小张', role: 'helper', lat: 31.3, lng: 121.5, accuracy: null, battery: null, heading: null, updatedAt: Date.now() - 8000, avatar: null },
    ] })
    render(<LocationsPage />)
    await flush(0) // 挂载即 poll；假计时器下 findBy 的 waitFor 会挂死，flush 后直接 getBy
    expect(screen.getByText('女儿')).toBeInTheDocument()
    expect(screen.getByText('志愿者小张')).toBeInTheDocument()
    expect(screen.getByText('2')).toBeInTheDocument() // 计数 Pill 与列表一致
  })
})
