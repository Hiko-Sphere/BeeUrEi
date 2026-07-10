// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'

// 强制英文语言，验证「已注销对端」不再漏出服务端硬编码的中文，而是客户端本地化。
vi.mock('react-router-dom', () => ({ Link: (p: { to: string; children: unknown }) => <a href={p.to}>{p.children as never}</a> }))
vi.mock('../lib/i18n', () => ({ useI18n: () => ({ lang: 'en', t: (_zh: string, en: string) => en }) }))
import { CallHistoryRow } from './CallHistoryRow'

const rec = (over: Record<string, unknown>) => ({ id: 'r', callId: 'c', direction: 'incoming', status: 'missed', peerId: 'p', peerName: 'Ming', peerAvatar: null, createdAt: 1_700_000_000_000, ...over })

describe('CallHistoryRow 已注销对端本地化（修 i18n 泄漏）', () => {
  it('英文用户 + 对端已注销(peerId=null) → 显示 "Deactivated user"，不漏服务端中文', () => {
    // 服务端对已注销对端把 peerName 回落成硬编码「已注销用户」——客户端须据 peerId===null 本地化覆盖。
    render(<ul><CallHistoryRow call={rec({ peerId: null, peerName: '已注销用户' })} /></ul>)
    expect(screen.getByText('Deactivated user')).toBeInTheDocument()
    expect(screen.queryByText('已注销用户')).toBeNull() // 中文绝不漏给英文用户
  })

  it('对端仍在(peerId 有) → 用真实姓名，不被本地化覆盖', () => {
    render(<ul><CallHistoryRow call={rec({ peerId: 'p', peerName: 'Ming' })} /></ul>)
    expect(screen.getByText('Ming')).toBeInTheDocument()
    expect(screen.queryByText('Deactivated user')).toBeNull()
  })
})
