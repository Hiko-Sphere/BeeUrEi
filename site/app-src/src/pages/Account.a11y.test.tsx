// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest'
import { render } from '@testing-library/react'
import { axeViolations } from '../lib/axeCheck'

/// 账户页无障碍门禁：Account 是**表单控件最密**的页（身份卡 + 安全区一排按钮 + Web Push/勿扰时段/推送分类/读回执
/// 开关 + 数据导出 + 医疗信息 + 语言 + 危险区），此前不在 axe 门禁内——开关/输入丢 label、图标按钮无名等回归风险最高。
/// 只审基础页（各弹窗未打开），已覆盖绝大多数常驻控件。axe 配置见 lib/axeCheck.ts（color-contrast/region 因 jsdom 禁用）。

vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }))
vi.mock('../lib/session', () => ({
  useSession: () => ({ user: { id: 'me', username: 'ming', displayName: '阿明', role: 'helper', status: 'active' }, refreshMe: vi.fn(), signOut: vi.fn() }),
}))
vi.mock('../lib/webPush', () => ({
  webPushSupported: () => false, // jsdom 无 PushManager：WebPushCard 走"不可用"静态分支
  isWebPushSubscribed: vi.fn().mockResolvedValue(false),
  subscribeWebPush: vi.fn(), unsubscribeWebPush: vi.fn(), resyncWebPushSubscription: vi.fn(),
}))
vi.mock('../lib/api', () => ({
  api: {
    me: vi.fn(), verificationStatus: vi.fn(), quietHours: vi.fn(), pushCategories: vi.fn(), medicalInfo: vi.fn(),
    // 动作/弹窗方法（基础页挂载不触发，存在即可）：
    deleteAccount: vi.fn(), revokeOtherSessions: vi.fn(), revokeSession: vi.fn(), sessions: vi.fn(),
    setAvatar: vi.fn(), setEmail: vi.fn(), setLanguage: vi.fn(), setMedicalInfo: vi.fn(), setPassword: vi.fn(),
    setPhone: vi.fn(), setProfile: vi.fn(), setPushCategories: vi.fn(), setQuietHours: vi.fn(), setReadReceipts: vi.fn(),
    setRole: vi.fn(), setUsername: vi.fn(), submitVerification: vi.fn(), twoFADisable: vi.fn(), twoFAEnable: vi.fn(),
    twoFARecovery: vi.fn(), twoFASetup: vi.fn(), twoFAStatus: vi.fn(), verifyEmail: vi.fn(), webPushTest: vi.fn(),
    webVapidKey: vi.fn(), withdrawVerification: vi.fn(),
  },
  APIError: class extends Error {},
  contentBlockedText: (_e: unknown, _t: unknown, fallback: string) => fallback,
  reencodeToJpeg: vi.fn(), blobToDataUrl: vi.fn(), uploadVerificationDoc: vi.fn(),
}))
import { api } from '../lib/api'
import { AccountPage } from './Account'

const mock = (fn: unknown) => fn as ReturnType<typeof vi.fn>

describe('Account 页无障碍门禁（axe 0 violations）', () => {
  it('身份卡 + 安全区 + WebPush/勿扰/推送分类/读回执开关 + 数据导出/医疗/语言/危险区：常驻控件均有可访问名，0 violations', async () => {
    mock(api.me).mockResolvedValue({
      id: 'me', username: 'ming', displayName: '阿明', role: 'helper', status: 'active', avatar: null, verified: false,
      language: 'zh', email: 'a@b.com', emailVerified: true, phone: null, usernameCustomized: true, appleLinked: false,
      twoFactorEnabled: false, legalConsentVersion: '1', legalConsentAt: 1, helperGuidelineAckAt: null, readReceiptsEnabled: true,
    })
    mock(api.verificationStatus).mockResolvedValue({ status: 'none' })
    mock(api.quietHours).mockResolvedValue({ quietHours: { enabled: false, startMinute: 1320, endMinute: 420, tz: 'Asia/Shanghai' } })
    mock(api.pushCategories).mockResolvedValue({ muted: [] })
    mock(api.medicalInfo).mockResolvedValue({ medicalInfo: '', updatedAt: null })

    const { container, findByText } = render(<AccountPage />)
    await findByText('阿明') // 等 api.me 回来、身份卡渲染完再审
    expect(await axeViolations(container)).toEqual([])
  })
})
