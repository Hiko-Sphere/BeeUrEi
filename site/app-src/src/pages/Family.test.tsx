// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

// useToast/useI18n 有默认 ctx；mock api + useCall(避 webrtc 链) + react-router 的 useNavigate。
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }))
vi.mock('./call/CallController', () => ({ useCall: () => ({ startOutgoing: vi.fn(), active: null }) }))
vi.mock('../lib/api', () => ({
  api: { familyLinks: vi.fn(), incomingLinks: vi.fn(), blocks: vi.fn(), unblock: vi.fn(), block: vi.fn(), deleteLink: vi.fn(), acceptLink: vi.fn(), addLink: vi.fn(), lookupUser: vi.fn() },
  APIError: class extends Error { code = ''; status = 0 },
}))
import { api } from '../lib/api'
import { FamilyPage } from './Family'

const mock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

describe('FamilyPage 黑名单渲染（回归：b.user.displayName，非已废弃的 b.blockedName）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mock(api.familyLinks).mockResolvedValue({ links: [] })
    mock(api.incomingLinks).mockResolvedValue({ links: [] })
  })

  it('已拉黑用户显示其 displayName（修复前读错字段会显示空/"?"）', async () => {
    mock(api.blocks).mockResolvedValue({ blocks: [{ id: 'b1', user: { id: 'u9', displayName: '张三', avatar: null } }] })
    render(<FamilyPage />)
    // 后端返回 { id, user: publicUser }；渲染须取 b.user.displayName。
    expect(await screen.findByText('张三')).toBeInTheDocument()
  })
})
