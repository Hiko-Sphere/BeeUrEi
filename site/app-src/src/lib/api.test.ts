import { describe, it, expect } from 'vitest'
import { APIError, chatErrorText, callErrorText, contentBlockedText } from './api'

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
    expect(chatErrorText(new APIError('media_too_large', 413), t)).toContain('太大')
    expect(chatErrorText(new APIError('unsupported_media_type', 400), t)).toContain('格式')
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
