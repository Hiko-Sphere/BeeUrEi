import { describe, it, expect } from 'vitest'
import { APIError, chatErrorText } from './api'

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
