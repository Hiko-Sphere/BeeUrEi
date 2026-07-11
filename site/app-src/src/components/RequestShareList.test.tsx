// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const h = vi.hoisted(() => ({ nav: vi.fn(), startOutgoing: vi.fn(), active: null as unknown }))
vi.mock('react-router-dom', () => ({ useNavigate: () => h.nav }))
vi.mock('../pages/call/CallController', () => ({ useCall: () => ({ startOutgoing: h.startOutgoing, active: h.active }) }))
vi.mock('../lib/api', () => ({
  api: { familyLinks: vi.fn(), requestLocation: vi.fn() },
  APIError: class extends Error { code = ''; status = 0 },
}))
import { api } from '../lib/api'
import { RequestShareList } from './RequestShareList'

const mock = (fn: unknown) => fn as ReturnType<typeof vi.fn>
const links = [
  { id: 'l1', memberId: 'm1', memberName: '妈妈', relation: '家人', isEmergency: true, status: 'accepted' },
  { id: 'l2', memberId: 'm2', memberName: '老王', relation: '邻居', isEmergency: false, status: 'accepted' },
  { id: 'l3', memberId: 'm3', memberName: '待定', relation: '亲友', isEmergency: false, status: 'pending' }, // 未接受：不列
]

describe('RequestShareList 请求共享位置（nudge）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    h.active = null
    mock(api.familyLinks).mockResolvedValue({ links })
    mock(api.requestLocation).mockResolvedValue({ ok: true })
  })

  it('只列已接受且未在共享的联系人；点击→ requestLocation(memberId)，按钮变"已请求"防连点', async () => {
    render(<RequestShareList sharingIds={new Set(['m2'])} />) // 老王在共享 → 不列
    expect(await screen.findByText('妈妈')).toBeInTheDocument()
    expect(screen.queryByText('老王')).not.toBeInTheDocument()   // 已在共享：不列
    expect(screen.queryByText('待定')).not.toBeInTheDocument()   // pending：不列
    fireEvent.click(screen.getByRole('button', { name: '请求 妈妈 共享位置' }))
    await waitFor(() => expect(api.requestLocation).toHaveBeenCalledWith('m1'))
    await waitFor(() => expect(screen.getByText('已请求')).toBeInTheDocument()) // 防连点
    expect(screen.getByRole('button', { name: '请求 妈妈 共享位置' })).toBeDisabled()
  })

  it('全部都在共享（无未共享联系人）→ 整卡不渲染（不出空卡）', async () => {
    render(<RequestShareList sharingIds={new Set(['m1', 'm2'])} />)
    await waitFor(() => expect(api.familyLinks).toHaveBeenCalled())
    expect(screen.queryByText('未在共享的联系人')).toBeNull()
  })

  it('未共享联系人可直接呼叫/发消息（担心时先联系，不必只能请求共享）', async () => {
    render(<RequestShareList sharingIds={new Set()} />)
    await screen.findByText('妈妈')
    fireEvent.click(screen.getByRole('button', { name: '呼叫 妈妈' }))
    expect(h.startOutgoing).toHaveBeenCalledWith('m1', '妈妈', undefined)
    fireEvent.click(screen.getByRole('button', { name: '给 妈妈 发消息' }))
    expect(h.nav).toHaveBeenCalledWith('/chat/m1')
  })

  it('通话中 → 呼叫按钮禁用、点击不触发 startOutgoing（防并发）；发消息不受限', async () => {
    h.active = { callId: 'c1' } // 模拟通话中
    render(<RequestShareList sharingIds={new Set()} />)
    await screen.findByText('妈妈')
    const callBtn = screen.getByRole('button', { name: '呼叫 妈妈' })
    expect(callBtn).toBeDisabled()
    fireEvent.click(callBtn)
    expect(h.startOutgoing).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '给 妈妈 发消息' }))
    expect(h.nav).toHaveBeenCalledWith('/chat/m1')
  })
})
