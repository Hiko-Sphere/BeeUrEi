// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'

// 强制英文 i18n（其余同名测试跑中文；本文件专测英文单复数正确性——n=1 不再说 "1 contacts"/"All 1 of..."）。
vi.mock('../lib/i18n', () => ({ useI18n: () => ({ t: (_zh: string, en: string) => en, lang: 'en', setLang: () => {} }) }))
vi.mock('../lib/api', () => ({ api: { emergencyReadiness: vi.fn(), sendTestAlert: vi.fn() }, APIError: class extends Error { status = 0 } }))
import { api } from '../lib/api'
import { EmergencyReadinessCard } from './EmergencyReadinessCard'

const mock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

describe('EmergencyReadinessCard 英文单复数（1 位联系人也语法正确）', () => {
  beforeEach(() => vi.clearAllMocks())

  it('恰 1 位紧急联系人且可达 → "Your emergency contact"（非 "All 1 of your emergency contacts"）', async () => {
    mock(api.emergencyReadiness).mockResolvedValue({ hasEmergencyContact: true, total: 1, reachable: 1, acceptedTotal: 1, acceptedReachable: 1,
      contacts: [{ name: 'Mom', relation: 'family', reachable: true }] })
    render(<EmergencyReadinessCard />)
    expect(await screen.findByText('Your emergency contact can receive instant alerts.')).toBeInTheDocument()
    expect(screen.queryByText(/All 1 of/)).toBeNull()
  })

  it('恰 1 位联系人、非紧急联系人 → "Your contact will be alerted"（非 "Your 1 contacts will all be"）', async () => {
    mock(api.emergencyReadiness).mockResolvedValue({ hasEmergencyContact: false, total: 0, reachable: 0, acceptedTotal: 1, acceptedReachable: 1, contacts: [] })
    render(<EmergencyReadinessCard />)
    expect(await screen.findByText(/^Your contact will be alerted in an emergency\./)).toBeInTheDocument()
    expect(screen.queryByText(/1 contacts/)).toBeNull()
  })

  it('恰 1 位联系人、不可达 → "You have 1 contact, but they can\'t"（非 "1 contacts, but none can"）', async () => {
    mock(api.emergencyReadiness).mockResolvedValue({ hasEmergencyContact: false, total: 0, reachable: 0, acceptedTotal: 1, acceptedReachable: 0, contacts: [] })
    render(<EmergencyReadinessCard />)
    const el = await screen.findByText(/You have 1 contact, but they can.t receive instant alerts/)
    expect(el).toBeInTheDocument()
    expect(screen.queryByText(/1 contacts/)).toBeNull()
  })

  it('2 位仍正确复数（回归）：非紧急 → "Your 2 contacts will all be alerted"', async () => {
    mock(api.emergencyReadiness).mockResolvedValue({ hasEmergencyContact: false, total: 0, reachable: 0, acceptedTotal: 2, acceptedReachable: 2, contacts: [] })
    render(<EmergencyReadinessCard />)
    expect(await screen.findByText(/Your 2 contacts will all be alerted/)).toBeInTheDocument()
  })
})
