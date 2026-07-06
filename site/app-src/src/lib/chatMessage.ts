/// 消息是否可转发：转发=把内容复制到另一会话，故仅**内容自包含**（inline）的类型可转发——收件人无需访问原会话
/// 即可看到/听到。文本/位置/图片/**语音**都是内联内容（图片与语音都是 data: URL、位置是内嵌坐标）；视频是 mediaId
/// （存服务器磁盘、按会话鉴权），转发到无权会话看不到，故不转发；撤回(recalled)/未知类型亦不转发。
/// 此前漏了 audio——它与 image 同为 data: URL 内联内容，应与图片一样可转发（对齐 WhatsApp/iMessage 转发语音）。
export function isForwardableKind(kind: string): boolean {
  return kind === 'text' || kind === 'location' || kind === 'image' || kind === 'audio'
}
