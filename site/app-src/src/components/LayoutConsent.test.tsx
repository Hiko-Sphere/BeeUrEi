// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

// 条款重新同意横幅：me.legalConsentVersion 与 app-config.legalVersion 不一致 → 显示，点击同意后记录并刷新。
const h = vi.hoisted(() => ({
  refreshMe: vi.fn().mockResolvedValue(undefined),
  self: { id: 'u1', username: 'amy', displayName: '阿明', role: 'helper', legalConsentVersion: null } as Record<string, unknown>,
}))
vi.mock('react-router-dom', () => ({
  NavLink: (p: { to: string; children: unknown }) => <a href={p.to}>{p.children as never}</a>,
  useLocation: () => ({ pathname: '/' }),
}))
vi.mock('../lib/session', () => ({
  useSession: () => ({ user: { id: 'u1', username: 'amy', displayName: '阿明', role: 'helper' }, self: h.self, signOut: vi.fn(), refreshMe: h.refreshMe }),
}))
vi.mock('../lib/api', () => ({
  api: {
    appConfig: vi.fn().mockResolvedValue({ legalVersion: '2' }),
    unreadSummary: vi.fn().mockResolvedValue({ notifications: 0, messages: 0 }),
    heartbeat: vi.fn().mockResolvedValue(undefined),
    legalConsent: vi.fn().mockResolvedValue({ ok: true }),
  },
}))
vi.mock('../pages/call/CallController', () => ({ CallProvider: (p: { children: unknown }) => p.children as never }))
import { Layout } from './Layout'
import { api } from '../lib/api'

describe('Layout 条款重新同意横幅', () => {
  afterEach(() => vi.clearAllMocks())

  it('已同意版本≠当前 legalVersion → 显示横幅；点击同意→ legalConsent(当前版本)+refreshMe', async () => {
    h.self = { id: 'u1', username: 'amy', displayName: '阿明', role: 'helper', legalConsentVersion: '1' } // 老版本
    render(<Layout><div>正文</div></Layout>)
    const btn = await screen.findByRole('button', { name: '我已阅读并同意' }) // config(legalVersion:'2') 异步加载后出现
    expect(screen.getByRole('alert')).toBeInTheDocument()
    fireEvent.click(btn)
    await waitFor(() => expect(api.legalConsent).toHaveBeenCalledWith('2')) // 记录同意**当前**版本
    await waitFor(() => expect(h.refreshMe).toHaveBeenCalled())             // 刷新 me → 横幅消失
  })

  it('已同意版本==当前 legalVersion → 不显示横幅', async () => {
    h.self = { id: 'u1', username: 'amy', displayName: '阿明', role: 'helper', legalConsentVersion: '2' } // 已是当前
    render(<Layout><div>正文</div></Layout>)
    await waitFor(() => expect(api.appConfig).toHaveBeenCalled()) // 等 config 加载完
    expect(screen.queryByRole('button', { name: '我已阅读并同意' })).toBeNull()
  })
})
