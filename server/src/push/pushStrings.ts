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
  emergencyAlertTitle: (name: string, l: PushLang): string =>
    l === 'en' ? `Emergency: ${name} may need help` : `紧急：${name} 可能需要帮助`,
  emergencyAlertBody: (kind: 'fall' | 'crash', hasLocation: boolean, l: PushLang): string => {
    if (l === 'en') {
      const what = kind === 'crash' ? 'a severe impact (possible crash)' : 'a possible fall'
      return `The app detected ${what} and no response.${hasLocation ? ' Location attached.' : ''} Please check in or call now.`
    }
    const what = kind === 'crash' ? '剧烈撞击（疑似车祸）' : '疑似摔倒'
    return `App 检测到${what}且无人响应。${hasLocation ? '已附带位置。' : ''}请立即联系或呼叫对方。`
  },
  newMessageTitle: (name: string, l: PushLang): string =>
    l === 'en' ? `Message from ${name}` : `${name} 发来消息`,
  newMessageBody: (preview: string, l: PushLang): string =>
    preview === '' ? (l === 'en' ? 'New message' : '新消息') : preview,
}
