/// 推送文案双语（E5 跨端收尾）：推送在 App 外展示，无法用客户端文案表——
/// 按收件人 users.language 选语言；未设置/非英文一律中文（与历史输出一致）。
export type PushLang = 'zh' | 'en'

export function pushLang(language?: string): PushLang {
  return language?.toLowerCase().startsWith('en') ? 'en' : 'zh'
}

export const pushStrings = {
  incomingCallTitle: (caller: string, l: PushLang): string =>
    l === 'en' ? `Incoming call from ${caller}` : `${caller} 来电`,
  incomingCallBody: (l: PushLang): string =>
    l === 'en' ? 'Tap to open the app and answer' : '点击打开 App 接听',
  friendRequestTitle: (l: PushLang): string =>
    l === 'en' ? 'New friend request' : '新的好友请求',
  friendRequestBody: (name: string, relation: string, l: PushLang): string =>
    l === 'en' ? `${name} wants to add you as ${relation}` : `${name} 想加你为${relation}`,
  friendAcceptedTitle: (l: PushLang): string =>
    l === 'en' ? 'Friend request accepted' : '好友请求已通过',
  friendAcceptedBody: (name: string, l: PushLang): string =>
    l === 'en' ? `${name} accepted your request` : `${name} 接受了你的请求`,
}
