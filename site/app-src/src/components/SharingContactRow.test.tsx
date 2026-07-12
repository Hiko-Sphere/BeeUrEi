// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SharingContactRow } from './SharingContactRow'
import type { ContactLocation } from '../lib/api'

const t = (zh: string, _en: string) => zh
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
