import { type ChatMessage } from '../db/store'
import { type PushLang } from '../push/pushStrings'

/// 消息推送预览（纯逻辑，可单测）。与客户端会话列表 `preview` 口径一致：媒体/位置类给
/// [图片]/[语音]/[视频]/[位置]；iOS 文本内嵌 Apple 地图链接亦归 [位置]；纯文本截断到 MAX_PREVIEW_CHARS。

export const MAX_PREVIEW_CHARS = 80

/// 代理对安全 + 带省略号的截断：超长文本截到 max 个 UTF-16 单位、缀 U+2026 省略号，且**绝不切断 emoji
/// 代理对**（否则末位留孤立高代理，渲染成 �、读屏读成乱码）。
/// 盲人收到的推送正文由 VoiceOver **读出**——视觉端系统给的"…"截断标记听不到，故须在正文里显式缀省略号，
/// 读屏才会读出/停顿、用户即知"还有更多，点开听全"（此前裸 slice(0,80) 既无截断信号又可能切断 emoji）。
export function truncatePreview(text: string, max = MAX_PREVIEW_CHARS): string {
  if (text.length <= max) return text
  let cut = text.slice(0, max)
  const lastCode = cut.charCodeAt(cut.length - 1)
  if (lastCode >= 0xd800 && lastCode <= 0xdbff) cut = cut.slice(0, -1) // 末位是高代理→回退一位，不切断 emoji
  return cut + '…'
}

/// 消息推送预览（本地化）。空文本由调用方（newMessageBody）兜「新消息」，此处不特判。
export function messagePreview(kind: ChatMessage['kind'], text: string, l: PushLang): string {
  if (kind === 'audio') return l === 'en' ? '[Voice message]' : '[语音消息]'
  if (kind === 'image') return l === 'en' ? '[Photo]' : '[图片]'
  if (kind === 'video') return l === 'en' ? '[Video]' : '[视频]'
  if (kind === 'location') return l === 'en' ? '[Location]' : '[位置]'
  // iOS 默认把位置发成 kind=text + 内嵌 Apple 地图链接：推送预览也显示 [位置]，
  // 否则盲人收到的推送是一串原始 maps URL（与 iOS/web 列表预览保持一致）。
  if (text.includes('https://maps.apple.com/?ll=')) return l === 'en' ? '[Location]' : '[位置]'
  return truncatePreview(text)
}
