import { describe, it, expect } from 'vitest'
import { isForwardableKind } from './chatMessage'

describe('isForwardableKind（仅内容自包含类型可转发）', () => {
  it('内联内容可转发：文本/位置/图片/语音', () => {
    for (const k of ['text', 'location', 'image', 'audio']) {
      expect(isForwardableKind(k)).toBe(true)
    }
  })
  it('语音与图片同为 data: URL，应一致可转发（回归此前漏 audio 的缺口）', () => {
    expect(isForwardableKind('audio')).toBe(isForwardableKind('image'))
  })
  it('视频(mediaId 非自包含)/撤回/未知/空 不可转发', () => {
    for (const k of ['video', 'recalled', 'system', '']) {
      expect(isForwardableKind(k)).toBe(false)
    }
  })
})
