// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

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
})
