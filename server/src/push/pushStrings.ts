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
  groupMessageTitle: (name: string, group: string, l: PushLang): string =>
    l === 'en' ? `${name} in ${group}` : `${name} 在「${group}」`,
  newMessageBody: (preview: string, l: PushLang): string =>
    preview === '' ? (l === 'en' ? 'New message' : '新消息') : preview,

  // —— 举报处理结果（通知通话双方）——
  // 隐私：举报人只被告知"已处理/是否采取措施"，**不**透露对对方施加的具体处罚；
  // 被举报人只被告知**关于自己**的结果。两条文案都不点名另一方。
  reportResolvedTitle: (l: PushLang): string =>
    l === 'en' ? 'Report update' : '举报处理结果',
  // 给举报人：dismissed=未发现违规；其它=已采取措施。
  reportResolvedReporterBody: (decision: string | undefined, l: PushLang): string => {
    if (decision === 'dismissed') return l === 'en' ? 'We reviewed your report and found no violation.' : '我们已审核你的举报，未发现违规。'
    if (decision === 'warned' || decision === 'suspended' || decision === 'banned') {
      return l === 'en' ? 'We reviewed your report and took action. Thank you.' : '我们已审核你的举报并采取了相应措施，感谢反馈。'
    }
    return l === 'en' ? 'Your report has been reviewed.' : '你的举报已处理。'
  },
  // 给被举报人：告知关于自己的结果。
  reportResolvedTargetBody: (decision: string | undefined, l: PushLang): string => {
    switch (decision) {
      case 'warned': return l === 'en' ? 'A report about you was reviewed. You have received a warning.' : '一项涉及你的举报已处理：你已被警告。'
      case 'suspended': return l === 'en' ? 'A report about you was reviewed. Your account has been suspended.' : '一项涉及你的举报已处理：你的账号已被暂停。'
      case 'banned': return l === 'en' ? 'A report about you was reviewed. Your account has been banned.' : '一项涉及你的举报已处理：你的账号已被封禁。'
      case 'dismissed': return l === 'en' ? 'A report about you was reviewed. No action was taken.' : '一项涉及你的举报已处理：未作处置。'
      default: return l === 'en' ? 'A report involving you has been resolved.' : '一项涉及你的举报已处理。'
    }
  },
}
