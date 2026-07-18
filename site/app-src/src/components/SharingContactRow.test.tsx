// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SharingContactRow } from './SharingContactRow'
import { api, type ContactLocation } from '../lib/api'

const t = (zh: string) => zh // 少参可赋给 (zh,en)=>string(TS 结构化类型),避开 no-unused-vars
const c: ContactLocation = { userId: 'u1', displayName: '小明', avatar: null, role: 'blind', lat: 31, lng: 121, updatedAt: Date.now(), battery: 15 }

describe('SharingContactRow 共享位置联系人行（定位/呼叫/发消息）', () => {
  afterEach(() => vi.restoreAllMocks())

  it('查看地址：点击→逆地理成文字街道地址并显示（读屏 aria-live 可闻）；带 AOI 时附"在X一带"', async () => {
    vi.spyOn(api, 'contactAddress').mockResolvedValue({
      address: '北京市朝阳区呼家楼街道景华南街5号', township: '呼家楼街道', aoi: { name: '华贸中心', distanceMeters: 0 },
    })
    render(<ul><SharingContactRow c={c} lang="zh" t={t} live onLocate={() => {}} onCall={() => {}} onMessage={() => {}} /></ul>)
    fireEvent.click(screen.getByRole('button', { name: '查看 小明 所在地址' }))
    expect(await screen.findByText(/北京市朝阳区呼家楼街道景华南街5号/)).toBeInTheDocument()
    expect(screen.getByText(/华贸中心/)).toBeInTheDocument() // AOI 大方位锚点一并呈现
    expect(api.contactAddress).toHaveBeenCalledWith('u1')
  })

  it('查看地址：带最近路口时附"附近路口X与Y交叉口"（转告出租/路人的强定位锚点）；同名两路不拼', async () => {
    vi.spyOn(api, 'contactAddress').mockResolvedValue({
      address: '建国路88号', township: '', intersection: { firstRoad: '建国路', secondRoad: '东三环', direction: '东', distanceMeters: 30 },
    })
    render(<ul><SharingContactRow c={c} lang="zh" t={t} live onLocate={() => {}} onCall={() => {}} onMessage={() => {}} /></ul>)
    fireEvent.click(screen.getByRole('button', { name: '查看 小明 所在地址' }))
    expect(await screen.findByText(/建国路88号，附近路口建国路与东三环交叉口/)).toBeInTheDocument()
  })

  it('查看地址：同名两路不成交叉口 → 不拼"X与X交叉口"（念给司机毫无意义）', async () => {
    vi.spyOn(api, 'contactAddress').mockResolvedValue({
      address: '人民路5号', township: '', intersection: { firstRoad: '人民路', secondRoad: '人民路', direction: '', distanceMeters: 0 },
    })
    render(<ul><SharingContactRow c={c} lang="zh" t={t} live onLocate={() => {}} onCall={() => {}} onMessage={() => {}} /></ul>)
    fireEvent.click(screen.getByRole('button', { name: '查看 小明 所在地址' }))
    const el = await screen.findByText(/人民路5号/)
    expect(el.textContent).not.toMatch(/交叉口/) // 同名 → 无路口子句
  })

  it('查看地址失败（境外/无数据/网络）→ 显式提示不留空（绝不让家人误以为无响应）', async () => {
    vi.spyOn(api, 'contactAddress').mockRejectedValue(new Error('address_not_found'))
    render(<ul><SharingContactRow c={c} lang="zh" t={t} live onLocate={() => {}} onCall={() => {}} onMessage={() => {}} /></ul>)
    fireEvent.click(screen.getByRole('button', { name: '查看 小明 所在地址' }))
    expect(await screen.findByText(/暂时无法获取地址/)).toBeInTheDocument()
  })

  it('对方移动后（updatedAt 变了）→ 旧地址隐藏，不显示误导性旧位置（追踪移动家人的关键）', async () => {
    vi.spyOn(api, 'contactAddress').mockResolvedValue({ address: '朝阳区A路1号', township: 'A街道' })
    const { rerender } = render(<ul><SharingContactRow c={c} lang="zh" t={t} live onLocate={() => {}} onCall={() => {}} onMessage={() => {}} /></ul>)
    fireEvent.click(screen.getByRole('button', { name: '查看 小明 所在地址' }))
    expect(await screen.findByText(/朝阳区A路1号/)).toBeInTheDocument()
    // 对方移动：同一联系人但 updatedAt 前进 → 旧地址过时须隐藏（家人可再点取新地址）。
    const moved = { ...c, lat: 40, lng: 117, updatedAt: c.updatedAt + 5000 }
    rerender(<ul><SharingContactRow c={moved} lang="zh" t={t} live onLocate={() => {}} onCall={() => {}} onMessage={() => {}} /></ul>)
    expect(screen.queryByText(/朝阳区A路1号/)).not.toBeInTheDocument()
  })

  it('渲染姓名 + 定位/呼叫/发消息三动作各触发对应回调', () => {
    const onLocate = vi.fn(), onCall = vi.fn(), onMessage = vi.fn()
    render(<ul><SharingContactRow c={c} lang="zh" t={t} live onLocate={onLocate} onCall={onCall} onMessage={onMessage} /></ul>)
    expect(screen.getByText('小明')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '在地图上定位 小明' })); expect(onLocate).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: '呼叫 小明' })); expect(onCall).toHaveBeenCalledTimes(1)
    fireEvent.click(screen.getByRole('button', { name: '给 小明 发消息' })); expect(onMessage).toHaveBeenCalledTimes(1)
  })

  it('通话中（callDisabled）→ 呼叫按钮禁用，点击不触发 onCall（避免并发呼叫）；发消息仍可用', () => {
    const onCall = vi.fn(), onMessage = vi.fn()
    render(<ul><SharingContactRow c={c} lang="zh" t={t} live callDisabled onLocate={() => {}} onCall={onCall} onMessage={onMessage} /></ul>)
    const callBtn = screen.getByRole('button', { name: '呼叫 小明' })
    expect(callBtn).toBeDisabled()
    fireEvent.click(callBtn); expect(onCall).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '给 小明 发消息' })); expect(onMessage).toHaveBeenCalledTimes(1) // 发消息不受通话中限制
  })

  it('无障碍行也呈现精度与行进方向（此前只在 Leaflet 气泡里，读屏家人看不到）——与气泡同 helper 口径', () => {
    // 有精度(20m)+移动中(heading 45°≈东北)：两者都须出现在**列表行文本**里，读屏家人无需地图即可知"多准/朝哪走"。
    const moving: ContactLocation = { ...c, accuracy: 20, heading: 45 }
    render(<ul><SharingContactRow c={moving} lang="zh" t={t} live onLocate={() => {}} onCall={() => {}} onMessage={() => {}} /></ul>)
    expect(screen.getByText(/精确到约 20 米/)).toBeInTheDocument()
    expect(screen.getByText(/正朝东北方向移动/)).toBeInTheDocument()
  })

  it('精度无效 / 静止无航向 → 各自省略（不画误导性数字、不瞎报方向），且不影响其余信息', () => {
    // accuracy=null（无有效精度）、heading=null（静止/不可用）：两段都不渲染，但姓名/角色仍在。
    const still: ContactLocation = { ...c, accuracy: null, heading: null }
    render(<ul><SharingContactRow c={still} lang="zh" t={t} live onLocate={() => {}} onCall={() => {}} onMessage={() => {}} /></ul>)
    expect(screen.getByText('小明')).toBeInTheDocument()
    expect(screen.queryByText(/精确到约/)).not.toBeInTheDocument()
    expect(screen.queryByText(/正朝.*方向移动/)).not.toBeInTheDocument()
  })

  it('实时状态圆点：live→脉动绿点(ring-live)；非 live→静态弱色点(不脉动、带释义)——避免假实时误导', () => {
    const { rerender } = render(<ul><SharingContactRow c={c} lang="zh" t={t} live onLocate={() => {}} onCall={() => {}} onMessage={() => {}} /></ul>)
    const dot = screen.getByTestId('live-dot')
    expect(dot.getAttribute('data-live')).toBe('1')
    expect(dot.className).toContain('ring-live')          // 脉动动画
    expect(dot.className).toContain('bg-ok')              // 绿色
    // 位置不再活跃更新（对方可能关页/断网/没电）→ 圆点不脉动、弱色、带悬停释义。
    rerender(<ul><SharingContactRow c={c} lang="zh" t={t} live={false} onLocate={() => {}} onCall={() => {}} onMessage={() => {}} /></ul>)
    const idle = screen.getByTestId('live-dot')
    expect(idle.getAttribute('data-live')).toBe('0')
    expect(idle.className).not.toContain('ring-live')     // 不脉动（不冒充实时）
    expect(idle.getAttribute('title')).toBe('共享中，暂无最新位置')
  })
})
