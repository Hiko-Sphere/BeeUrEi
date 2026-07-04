/// 推送文案双语（E5 跨端收尾）：推送在 App 外展示，无法用客户端文案表——
/// 按收件人 users.language 选语言；未设置/非英文一律中文（与历史输出一致）。
export type PushLang = 'zh' | 'en'

export function pushLang(language?: string): PushLang {
  return language?.toLowerCase().startsWith('en') ? 'en' : 'zh'
}

/// 地点 label 展示名：home/work 是保留 label，本地化为"家/公司"；自定义 label（如"医院"）原样。
function placeLabelName(label: string, l: PushLang): string {
  if (label === 'home') return l === 'en' ? 'home' : '家'
  if (label === 'work') return l === 'en' ? 'work' : '公司'
  return label
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
  // 到达围栏（Life360/Find My "已到家"式）：家/公司 是保留 label，本地化；自定义 label 原样。
  placeArrivalTitle: (name: string, label: string, l: PushLang): string => {
    const place = placeLabelName(label, l)
    return l === 'en' ? `${name} arrived at ${place}` : `${name}已到达${place}`
  },
  placeArrivalBody: (name: string, label: string, l: PushLang): string => {
    const place = placeLabelName(label, l)
    return l === 'en' ? `${name} has safely arrived at ${place}.` : `${name}已经安全到达${place}。`
  },
  groupAddedTitle: (l: PushLang): string =>
    l === 'en' ? 'Added to a group chat' : '你被加入了群聊',
  groupAddedBody: (name: string, groupName: string, l: PushLang): string =>
    l === 'en' ? `${name} added you to the group "${groupName}"` : `${name} 把你加入了群聊「${groupName}」`,
  groupRemovedTitle: (l: PushLang): string =>
    l === 'en' ? 'Removed from a group chat' : '你已被移出群聊',
  groupRemovedBody: (groupName: string, l: PushLang): string =>
    l === 'en' ? `You are no longer in the group "${groupName}"` : `你已不在群聊「${groupName}」中`,
  groupDissolvedTitle: (l: PushLang): string =>
    l === 'en' ? 'A group chat was dissolved' : '群聊已解散',
  groupDissolvedBody: (groupName: string, l: PushLang): string =>
    l === 'en' ? `The group "${groupName}" has been dissolved` : `群聊「${groupName}」已被群主解散`,
  emergencyAlertTitle: (name: string, l: PushLang): string =>
    l === 'en' ? `Emergency: ${name} may need help` : `紧急：${name} 可能需要帮助`,
  /// 告警正文的电量段（battery=告警**发出时刻**的手机电量%）：≤20% 点明"可能很快关机"——亲友知道联系窗口
  /// 有限、要立刻行动。未知(undefined)不提。只在首呼即时消息里用，**不**随升级重呼重播（几分钟后早已陈旧、会误导）。
  emergencyBatterySegment: (battery: number | undefined, l: PushLang): string => {
    if (battery == null || battery < 0 || battery > 100) return ''
    if (battery <= 20) {
      return l === 'en' ? ` Phone battery only ${battery}% — it may shut down soon.` : `手机电量仅剩 ${battery}%，可能很快关机。`
    }
    return l === 'en' ? ` Phone battery ${battery}%.` : `手机电量 ${battery}%。`
  },
  emergencyAlertBody: (kind: 'fall' | 'crash' | 'manual' | string, hasLocation: boolean, l: PushLang, battery?: number): string => {
    const batt = pushStrings.emergencyBatterySegment(battery, l)
    if (kind === 'manual') {
      return l === 'en'
        ? `${'They'} pressed the emergency button and may need help.${hasLocation ? ' Location attached.' : ''}${batt} Please contact or call them now.`
        : `对方按下了紧急求助按钮，可能需要帮助。${hasLocation ? '已附带位置。' : ''}${batt}请立即联系或呼叫对方。`
    }
    if (l === 'en') {
      const what = kind === 'crash' ? 'a severe impact (possible crash)' : 'a possible fall'
      return `The app detected ${what} and no response.${hasLocation ? ' Location attached.' : ''}${batt} Please check in or call now.`
    }
    const what = kind === 'crash' ? '剧烈撞击（疑似车祸）' : '疑似摔倒'
    return `App 检测到${what}且无人响应。${hasLocation ? '已附带位置。' : ''}${batt}请立即联系或呼叫对方。`
  },
  // 亲友确认收到你的紧急求助 → 回告发起人"有人在响应"（遇险者最需要的反馈：知道不是石沉大海）。
  emergencyAckTitle: (name: string, l: PushLang): string =>
    l === 'en' ? `${name} saw your alert` : `${name} 已看到你的求助`,
  emergencyAckBody: (name: string, l: PushLang): string =>
    l === 'en' ? `${name} acknowledged your emergency alert and knows you may need help.`
               : `${name} 已确认收到你的紧急求助，知道你可能需要帮助。`,
  // 升级重呼：告警发出后达阈值时长仍无任何亲友确认 → 再推一次、措辞更急，争取抓住第一次漏看的人（医疗警报的 escalation）。
  emergencyEscalateTitle: (name: string, l: PushLang): string =>
    l === 'en' ? `Still unanswered: ${name} needs help` : `仍无人回应：${name} 需要帮助`,
  emergencyEscalateBody: (minutes: number, hasLocation: boolean, l: PushLang): string =>
    l === 'en' ? `Their emergency alert has gone unanswered for about ${minutes} minutes.${hasLocation ? ' Location attached.' : ''} Please check on them now.`
               : `对方的紧急求助已约 ${minutes} 分钟无人回应。${hasLocation ? '已附带位置。' : ''}请立即查看。`,
  // 发起人在告警发出后报平安 → 回告亲友"解除"，让刚收到告警而担心/赶来的人立刻安心（安全类 App 的 all-clear）。
  emergencyClearTitle: (name: string, l: PushLang): string =>
    l === 'en' ? `${name} is OK` : `${name} 报平安了`,
  emergencyClearBody: (name: string, l: PushLang): string =>
    l === 'en' ? `${name} marked the earlier emergency alert as resolved — false alarm or they're OK now.`
               : `${name} 已解除刚才的紧急求助——是误报，或现在已经没事了。`,
  // 安全报到到期未确认 → 自动告警亲友（personal-safety "safety timer" 到点未 check-in）。
  // 复用 emergency_alert 通知类别（亲友端已有的告警显著度/回拨/图标全部生效），正文点明是"未按时报平安"
  // 而非摔倒，并带上本人设定的备注（"步行回家"）帮助判断去哪找人。
  safetyCheckinMissedTitle: (name: string, l: PushLang): string =>
    l === 'en' ? `${name} missed a safety check-in` : `${name} 未按时报平安`,
  safetyCheckinMissedBody: (note: string | undefined, l: PushLang): string => {
    const n = (note ?? '').trim()
    const noteSeg = n ? (l === 'en' ? ` Note: "${n}".` : `备注：“${n}”。`) : ''
    return l === 'en'
      ? `They set a safety check-in timer and didn't confirm they're safe in time.${noteSeg} Please contact or check on them now.`
      : `对方设置了安全报到，但未在约定时间确认平安。${noteSeg}请立即联系或确认对方是否安全。`
  },
  // 安全报到到期时服务端正好宕机、恢复后已超陈旧宽限 → **不惊动亲友**（免重启误报风暴），但给**本人**留一条
  // 通知：诚实告知"断网期间到期、未替你通知亲友"，若仍需帮助可手动求助。非静默兜底（对抗复审 CONFIRMED#2）。
  safetyCheckinExpiredSelfTitle: (l: PushLang): string =>
    l === 'en' ? 'Safety check-in expired offline' : '安全报到已过期（曾断网）',
  safetyCheckinExpiredSelfBody: (l: PushLang): string =>
    l === 'en'
      ? 'Your safety check-in expired while the service was unreachable, so we did not alert your contacts. If you still need help, please send an SOS now.'
      : '你的安全报到到期时服务暂时无法访问，我们未替你通知亲友。如果你仍需要帮助，请立即手动发起求助。',
  // 账号安全敏感变更通知本人（改密/改邮箱/开关 2FA…）：**未授权变更即时预警**——盗号者一旦改密/关 2FA，
  // 真实用户在自己设备上立刻收到（本人操作则是确认）。industry-standard（各家都"密码已修改"邮件/通知）。
  securityNotice: (event: 'password_changed' | 'password_reset' | 'email_changed' | '2fa_enabled' | '2fa_disabled',
                   l: PushLang): { title: string; body: string } => {
    const en = l === 'en'
    switch (event) {
      case 'password_changed': return { title: en ? 'Password changed' : '账号密码已修改',
        body: en ? 'Your account password was just changed. If this wasn’t you, reset your password immediately.' : '你的账号密码刚刚被修改。若非本人操作，请立即重置密码。' }
      case 'password_reset': return { title: en ? 'Password was reset' : '账号密码已被重置',
        body: en ? 'Your password was just reset via account recovery. If this wasn’t you, secure your account now.' : '你的账号密码刚刚通过“找回密码”被重置。若非本人操作，请立即处理。' }
      case 'email_changed': return { title: en ? 'Account email changed' : '账号邮箱已更改',
        body: en ? 'The email on your account was just changed. If this wasn’t you, secure your account now.' : '你的账号邮箱刚刚被更改。若非本人操作，请立即处理。' }
      case '2fa_enabled': return { title: en ? 'Two-factor turned on' : '已开启两步验证',
        body: en ? 'Two-factor authentication was enabled on your account.' : '你的账号刚刚开启了两步验证。' }
      case '2fa_disabled': return { title: en ? 'Two-factor turned off' : '已关闭两步验证',
        body: en ? 'Two-factor authentication was disabled. If this wasn’t you, change your password and re-enable it now.' : '你的账号刚刚关闭了两步验证。若非本人操作，请立即修改密码并重新开启。' }
    }
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
