// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SharingContactRow } from './SharingContactRow'
import type { ContactLocation } from '../lib/api'

const t = (zh: string) => zh // 少参可赋给 (zh,en)=>string(TS 结构化类型),避开 no-unused-vars
const c: ContactLocation = { userId: 'u1', displayName: '小明', avatar: null, role: 'blind', lat: 31, lng: 121, updatedAt: Date.now(), battery: 15 }

describe('SharingContactRow 共享位置联系人行（定位/呼叫/发消息）', () => {
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
