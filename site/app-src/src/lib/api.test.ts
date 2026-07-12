import { describe, it, expect } from 'vitest'
import { APIError, chatErrorText, callErrorText, contentBlockedText, buildLoginBody } from './api'

// 取中文分支断言（t 返回 zh）。少写一个形参即可——TS 允许少参函数赋给 (zh,en)=>string。
const t = (zh: string) => zh

describe('chatErrorText 错误码→用户文案映射', () => {
  it('"重试也没用"的状态各有专属文案，区别于瞬时失败', () => {
    expect(chatErrorText(new APIError('feature_disabled', 403), t)).toContain('关闭')
    expect(chatErrorText(new APIError('maintenance', 503), t)).toContain('维护')
    expect(chatErrorText(new APIError('content_blocked', 403), t)).toContain('禁止')
    expect(chatErrorText(new APIError('message_too_long', 400), t)).toContain('太长')
    expect(chatErrorText(new APIError('blocked', 403), t)).toContain('拉黑')
    expect(chatErrorText(new APIError('not_linked', 403), t)).toContain('联系人')
    expect(chatErrorText(new APIError('not_member', 403), t)).toContain('群聊')
    expect(chatErrorText(new APIError('group_full', 400), t)).toContain('已满') // 群满员：加人被拒须讲清"满了"而非笼统"操作失败"
    expect(chatErrorText(new APIError('media_too_large', 413), t)).toContain('太大')
    expect(chatErrorText(new APIError('media_quota_exceeded', 413), t)).toContain('已满') // 配额满≠文件太大：引导清理而非换小文件
    expect(chatErrorText(new APIError('unsupported_media_type', 400), t)).toContain('格式')
    expect(chatErrorText(new APIError('too_many_requests', 429), t)).toContain('频繁') // 限流→"稍候"而非笼统"重试"
    // 撤回/编辑时限与可编辑性：给**确定**文案（此前靠带"？"的兜底猜时限，且掩盖功能关停/维护等真因）。
    expect(chatErrorText(new APIError('recall_window_passed', 400), t)).toContain('无法撤回')
    expect(chatErrorText(new APIError('recall_window_passed', 400), t)).not.toContain('？') // 不再是猜测
    expect(chatErrorText(new APIError('edit_window_passed', 400), t)).toContain('无法编辑')
    expect(chatErrorText(new APIError('not_editable', 400), t)).toContain('不可编辑')
    // 撤回时若是功能关停/维护（非时限），映射到真因而非误导的"超过 2 分钟"（recall 已改用本映射）。
    expect(chatErrorText(new APIError('feature_disabled', 403), t)).not.toContain('撤回')
  })

  it('未知码/非 APIError 用兜底；显式 fallback 优先', () => {
    expect(chatErrorText(new APIError('weird_code', 500), t)).toBe('发送失败')
    expect(chatErrorText(new Error('boom'), t)).toBe('发送失败') // 非 APIError → 兜底
    expect(chatErrorText(new APIError('weird_code', 500), t, '图片发送失败')).toBe('图片发送失败')
  })
})

describe('callErrorText 呼叫/求助错误码→用户文案映射', () => {
  it('功能门禁/维护是"重试也没用"，与 iOS callErrorText 同口径给专属文案', () => {
    // /api/assist/call 与 /help/claim 受 requireFeature 门控，关停/维护会返回这两码——协助者不应被压成"呼叫失败"而反复重试。
    expect(callErrorText(new APIError('feature_disabled', 403), t, '呼叫失败')).toContain('关闭')
    expect(callErrorText(new APIError('maintenance', 503), t, '呼叫失败')).toContain('维护')
    expect(callErrorText(new APIError('not_linked', 403), t, '呼叫失败')).toContain('联系')
    expect(callErrorText(new APIError('already_claimed_or_gone', 409), t, '认领失败')).toContain('已被认领')
    expect(callErrorText(new APIError('too_many_requests', 429), t, '呼叫失败')).toContain('频繁')
  })

  it('未知码/非 APIError 落到各调用点的 fallback', () => {
    expect(callErrorText(new APIError('weird_code', 500), t, '呼叫失败')).toBe('呼叫失败')
    expect(callErrorText(new Error('boom'), t, '认领失败')).toBe('认领失败')
  })
})

describe('contentBlockedText 内容过滤→用户文案', () => {
  it('content_blocked（昵称/用户名/关系/群名输入）给专属"不被允许"文案，不压成 fallback', () => {
    expect(contentBlockedText(new APIError('content_blocked', 403), t, '保存失败')).toContain('不被允许')
  })
  it('其余码/非 APIError 落到各调用点 fallback', () => {
    expect(contentBlockedText(new APIError('username_taken', 409), t, '保存失败')).toBe('保存失败')
    expect(contentBlockedText(new Error('boom'), t, '发送失败')).toBe('发送失败')
  })
})

describe('buildLoginBody 登录请求体（标识一律作 username 字段）', () => {
  it('邮箱/手机号/用户名都放进 username 字段，绝不拆成 email/phone（否则缺 username 被 400）', () => {
    for (const id of ['alice@example.com', '13800138000', '+86 138-0013-8000', 'alice']) {
      const b = buildLoginBody(id, 'pw')
      expect(b.username).toBe(id) // 原样作 username 传，服务端 findByLoginIdentifier 解析
      expect(b.password).toBe('pw')
      expect('email' in b).toBe(false)
      expect('phone' in b).toBe(false)
    }
  })
  it('带 TOTP 时透传 totpCode，否则不含该键', () => {
    expect(buildLoginBody('alice', 'pw', '123456').totpCode).toBe('123456')
    expect('totpCode' in buildLoginBody('alice', 'pw')).toBe(false)
  })
})
