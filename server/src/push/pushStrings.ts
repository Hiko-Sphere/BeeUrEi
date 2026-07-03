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
  routeAddedTitle: (l: PushLang): string =>
    l === 'en' ? 'A route was added for you' : '有人为你添加了路线',
  routeAddedBody: (name: string, routeName: string, l: PushLang): string =>
    l === 'en' ? `${name} added the route "${routeName}" — open Navigation to walk it`
               : `${name} 为你添加了路线「${routeName}」，可在导航里沿信标行走`,
  emergencyAlertTitle: (name: string, l: PushLang): string =>
    l === 'en' ? `Emergency: ${name} may need help` : `紧急：${name} 可能需要帮助`,
  emergencyAlertBody: (kind: 'fall' | 'crash' | 'manual' | string, hasLocation: boolean, l: PushLang): string => {
    if (kind === 'manual') {
      return l === 'en'
        ? `${'They'} pressed the emergency button and may need help.${hasLocation ? ' Location attached.' : ''} Please contact or call them now.`
        : `对方按下了紧急求助按钮，可能需要帮助。${hasLocation ? '已附带位置。' : ''}请立即联系或呼叫对方。`
    }
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

  // —— 实名认证（KYC）审核结果 ——
  kycVerifiedTitle: (l: PushLang): string =>
    l === 'en' ? 'Identity verified' : '实名认证已通过',
  kycVerifiedBody: (l: PushLang): string =>
    l === 'en' ? 'Your identity has been verified. The verified badge now appears on your profile.' : '你的实名认证已通过，账号已显示「已认证」徽章。',
  kycRejectedTitle: (l: PushLang): string =>
    l === 'en' ? 'Identity verification not approved' : '实名认证未通过',
  // 拒绝原因 → 用户可读句子（双语）。引导用户如何修正后重新提交。
  kycRejectReason: (code: string | undefined, l: PushLang): string => {
    const zh: Record<string, string> = {
      blurry: '证件照片不够清晰，请在光线充足处重拍。',
      glare: '证件照片有反光，请避开强光后重拍。',
      name_mismatch: '填写姓名与证件不一致，请核对后重新提交。',
      face_mismatch: '自拍与证件照片不匹配，请由本人重新拍摄。',
      expired: '证件已过期，请使用有效证件。',
      unsupported_doc: '证件类型不被支持，请更换证件。',
      incomplete: '提交资料不完整，请补齐后重新提交。',
      suspected_fraud: '审核未通过。如有疑问请联系支持。',
      timeout: '提交超过审核时限已关闭，请重新提交。',
      revoked: '实名认证已被撤销。如有疑问请联系支持。',
      other: '审核未通过，请重新提交。',
    }
    const en: Record<string, string> = {
      blurry: 'The document photo was too blurry. Please retake it in good lighting.',
      glare: 'The document photo had glare. Please retake it without reflections.',
      name_mismatch: 'The name did not match the document. Please check and resubmit.',
      face_mismatch: 'The selfie did not match the document. Please retake it yourself.',
      expired: 'The document has expired. Please use a valid document.',
      unsupported_doc: 'The document type is not supported. Please use another document.',
      incomplete: 'The submission was incomplete. Please complete it and resubmit.',
      suspected_fraud: 'Verification was not approved. Contact support if you have questions.',
      timeout: 'The submission timed out and was closed. Please resubmit.',
      revoked: 'Your identity verification was revoked. Contact support if you have questions.',
      other: 'Verification was not approved. Please resubmit.',
    }
    const map = l === 'en' ? en : zh
    return map[code ?? 'other'] ?? map.other
  },
}
