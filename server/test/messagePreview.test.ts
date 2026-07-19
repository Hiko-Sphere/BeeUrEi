import { describe, it, expect } from 'vitest'
import { messagePreview, truncatePreview, MAX_PREVIEW_CHARS } from '../src/notifications/messagePreview'

describe('messagePreview 推送预览（媒体占位 + 本地化 + 与客户端列表口径一致）', () => {
  it('媒体/位置类给本地化占位', () => {
    expect(messagePreview('audio', 'x', 'zh')).toBe('[语音消息]')
    expect(messagePreview('audio', 'x', 'en')).toBe('[Voice message]')
    expect(messagePreview('image', 'x', 'zh')).toBe('[图片]')
    expect(messagePreview('video', 'x', 'en')).toBe('[Video]')
    expect(messagePreview('location', '{"lat":1,"lng":2}', 'zh')).toBe('[位置]')
  })
  it('iOS 文本内嵌 Apple 地图链接 → [位置]（不泄露原始 maps URL）', () => {
    expect(messagePreview('text', '来这里 https://maps.apple.com/?ll=39.9,116.4', 'zh')).toBe('[位置]')
    expect(messagePreview('text', 'here https://maps.apple.com/?ll=1,2', 'en')).toBe('[Location]')
  })
  it('短文本原样返回（不截断、不加省略号）', () => {
    expect(messagePreview('text', '你好，今天天气不错', 'zh')).toBe('你好，今天天气不错')
    expect(messagePreview('text', 'x'.repeat(MAX_PREVIEW_CHARS), 'zh')).toBe('x'.repeat(MAX_PREVIEW_CHARS)) // 恰好 80 不截
  })
})

describe('truncatePreview 代理对安全 + 省略号（盲人靠读屏听截断信号）', () => {
  it('超长文本截到 80 + 缀省略号（读屏读出/停顿=用户知还有更多）', () => {
    const p = truncatePreview('a'.repeat(200))
    expect(p.length).toBe(MAX_PREVIEW_CHARS + 1) // 80 + …
    expect(p.endsWith('…')).toBe(true)
    expect(p.startsWith('a'.repeat(MAX_PREVIEW_CHARS))).toBe(true)
  })
  it('不切断 emoji 代理对（否则末位孤立高代理→渲染 �、读屏乱码）', () => {
    // 👍 = U+1F44D（代理对 👍），落在 UTF-16 下标 79-80：naive slice(0,80) 会切成孤立高代理。
    const withEmojiAtBoundary = 'a'.repeat(79) + '👍' + 'b'.repeat(50)
    const p = truncatePreview(withEmojiAtBoundary)
    expect(p).not.toContain('�')                        // 无替换符
    const beforeEllipsis = p.slice(0, -1)                    // 去掉末尾省略号
    expect(/[\uD800-\uDBFF]$/.test(beforeEllipsis)).toBe(false) // 末位不是孤立高代理
    expect(p.endsWith('…')).toBe(true)
  })
  it('末位是完整字符时正常截（无回退）', () => {
    const p = truncatePreview('中'.repeat(100)) // 中=单 UTF-16 单位
    expect(p).toBe('中'.repeat(MAX_PREVIEW_CHARS) + '…')
  })
})
