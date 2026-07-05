// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

// UsersTab 只需 api（adminUsers）+ useI18n(默认 ctx→中文)+ useToast(默认 ctx)。
vi.mock('../lib/api', () => ({ api: { adminUsers: vi.fn(), adminSetStatus: vi.fn() }, APIError: class extends Error {} }))
import { api } from '../lib/api'
import { UsersTab } from './Admin'

describe('Admin UsersTab 实名徽标（审核可判断是否可追责）', () => {
  beforeEach(() => vi.clearAllMocks())

  it('已实名用户显示"已实名"徽标、未实名不显示——服务端 verified 此前是死字段', async () => {
    ;(api.adminUsers as ReturnType<typeof vi.fn>).mockResolvedValue({
      users: [
        { id: 'u1', username: 'alice', displayName: '实名用户', role: 'blind', status: 'active', createdAt: 1_700_000_000_000, verified: true },
        { id: 'u2', username: 'bob', displayName: '匿名用户', role: 'helper', status: 'active', createdAt: 1_700_000_000_000, verified: false },
      ],
      total: 2,
    })
    render(<UsersTab />)
    expect(await screen.findByText('实名用户')).toBeInTheDocument()
    expect(await screen.findByText('匿名用户')).toBeInTheDocument()
    // 徽标只出现一次（给已实名的那位）；未实名的不显示。
    const badges = screen.getAllByText('已实名')
    expect(badges.length).toBe(1)
  })
})
