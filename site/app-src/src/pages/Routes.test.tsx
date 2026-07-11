// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

// Leaflet 仅在编辑态用（地图 div），列表态不触发（effect 守卫 editing）——桩掉即可，测只审列表渲染。
vi.mock('leaflet', () => ({ default: { map: vi.fn(), tileLayer: vi.fn(() => ({ addTo: vi.fn() })), marker: vi.fn() } }))
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }))
vi.mock('../lib/session', () => ({ useSession: () => ({ user: { id: 'me', displayName: '阿明', role: 'blind' } }) }))
vi.mock('../lib/api', () => ({
  api: { listRoutes: vi.fn(), familyLinks: vi.fn(), createRoute: vi.fn(), updateRoute: vi.fn(), deleteRoute: vi.fn() },
  APIError: class extends Error {},
}))
import { api } from '../lib/api'
import { RoutesPage } from './Routes'

const mock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

describe('RoutesPage 路线创建者透明（死字段修复：服务端下发 createdByName，列表此前从不呈现）', () => {
  beforeEach(() => vi.clearAllMocks())

  it('别人替我画的路线（role=owner + createdByName）显示"由 X 创建"；自己画的不显示', async () => {
    mock(api.familyLinks).mockResolvedValue({ links: [] })
    mock(api.listRoutes).mockResolvedValue({ routes: [
      { id: 'r1', ownerId: 'me', createdBy: 'dau', createdByName: '女儿', name: '家到菜场',
        waypoints: [{ lat: 31, lng: 121 }, { lat: 31.01, lng: 121.01 }], createdAt: 1, updatedAt: 2, role: 'owner' },
      { id: 'r2', ownerId: 'me', createdBy: 'me', createdByName: null, name: '自画路线',
        waypoints: [{ lat: 31, lng: 121 }], createdAt: 1, updatedAt: 1, role: 'owner' },
    ] })
    render(<RoutesPage />)
    expect(await screen.findByText('家到菜场')).toBeInTheDocument()
    expect(screen.getByText('由 女儿 创建')).toBeInTheDocument()     // r1：别人画的 → 显示创建者（信任透明）
    expect(screen.getByText('自画路线')).toBeInTheDocument()
    // r2 自画（createdByName=null）不出"由…创建"——全页恰一条创建者行。
    expect(screen.getAllByText(/由 .+ 创建/)).toHaveLength(1)
  })

  it('我替别人画的路线（role=creator）不显示"由我创建"（冗余）——仅"给对方"归属已足', async () => {
    mock(api.familyLinks).mockResolvedValue({ links: [{ id: 'l1', memberId: 'blindA', memberName: '小明', relation: '朋友', isEmergency: false, status: 'accepted' }] })
    mock(api.listRoutes).mockResolvedValue({ routes: [
      { id: 'r3', ownerId: 'blindA', createdBy: 'me', createdByName: '阿明', name: '公司路线',
        waypoints: [{ lat: 31, lng: 121 }, { lat: 31.02, lng: 121.02 }], createdAt: 1, updatedAt: 3, role: 'creator' },
    ] })
    render(<RoutesPage />)
    expect(await screen.findByText('公司路线')).toBeInTheDocument()
    expect(screen.queryByText(/由 .+ 创建/)).toBeNull() // creator 视角：我知道是自己画的，不赘述
  })
})
