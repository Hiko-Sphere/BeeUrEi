/// 推送文案双语（E5 跨端收尾）：推送在 App 外展示，无法用客户端文案表——
/// 按收件人 users.language 选语言；未设置/非英文一律中文（与历史输出一致）。
export type PushLang = 'zh' | 'en'

export function pushLang(language?: string): PushLang {
  return language?.toLowerCase().startsWith('en') ? 'en' : 'zh'
}

/// 账号安全敏感变更事件（**登录凭据/方式的任何增删改**都须预警本人=接管/锁定信号）。
/// 单一真相：account/recovery/passkey 各路都经此类型 + notifyAccountSecurity 发，杜绝各写各的漂移。
/// 新增登录方式（未来的第三方登录等）时**务必**在此补一项并接线（见 notifyAccountSecurity）。
export type SecurityEvent =
  | 'password_changed' | 'password_reset'
  | 'email_changed' | 'phone_changed' | 'username_changed'
  | 'apple_linked' | 'apple_unlinked'
  | 'passkey_added' | 'passkey_removed'
  | '2fa_enabled' | '2fa_disabled'
  // 管理员/客服代为变更登录凭据（透明告知本人 + 侦测被盗管理员账号借后台接管受害者）：
  | 'admin_password_reset' | 'admin_passkey_cleared' | 'admin_apple_unlinked'

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
  // 离开围栏（Life360/Find My "离开家"式，与到达对等）：盲人/年长家人离开家/公司时提醒仍在看其共享位置的亲友，
  // "意外离家"与"平安到家"同等有价值（皆不增加新暴露——收件者本就能看其位置）。
  placeDepartureTitle: (name: string, label: string, l: PushLang): string => {
    const place = placeLabelName(label, l)
    return l === 'en' ? `${name} left ${place}` : `${name}已离开${place}`
  },
  placeDepartureBody: (name: string, label: string, l: PushLang): string => {
    const place = placeLabelName(label, l)
    return l === 'en' ? `${name} has left ${place}.` : `${name}已经离开${place}。`
  },
  // 共享位置者电量低（Life360/Find My "X 的手机电量低"式）：手机是盲人导航+SOS 的唯一工具，
  // 家人在其失联前主动联系。只在跌破阈值那次提醒（滞回防抖）。
  contactLowBatteryTitle: (name: string, l: PushLang): string =>
    l === 'en' ? `${name}'s phone battery is low` : `${name}的手机电量低`,
  contactLowBatteryBody: (name: string, pct: number, l: PushLang): string =>
    l === 'en' ? `${name}'s phone is at ${pct}% while sharing location — they may go offline soon. Consider checking in.`
               : `${name}正在共享位置，手机电量仅剩 ${pct}%，可能很快失联。建议主动联系确认。`,
  // 极低电量（第二级，更急）：手机很快关机=盲人彻底失去导航/SOS/求助，请**尽快**联系。
  contactCriticalBatteryTitle: (name: string, l: PushLang): string =>
    l === 'en' ? `${name}'s phone is about to die` : `${name}的手机即将关机`,
  contactCriticalBatteryBody: (name: string, pct: number, l: PushLang): string =>
    l === 'en' ? `${name}'s phone is critically low at ${pct}% while sharing location and may shut off very soon — please reach them now.`
               : `${name}正在共享位置，手机电量仅剩 ${pct}%，很快就会关机、彻底失联。请尽快联系。`,
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
  // 有亲友开始响应 → **安静**通知其余亲友"已有人在处理"（响应者协调：避免全体同时赶去/同时打电话把遇险者
  // 淹没，也避免"都以为别人在管"没人去）。匿名（不点名响应者）——收件人本就都收到了该次告警，只补"正被处理"
  // 一条信息，不新增任何关于遇险者或响应者身份的暴露。绝非告警：kind=emergency_responding 不触发响铃大模态。
  emergencyRespondingTitle: (senderName: string, l: PushLang): string =>
    l === 'en' ? `Someone is responding to ${senderName}'s alert` : `已有人在响应 ${senderName} 的求助`,
  emergencyRespondingBody: (senderName: string, l: PushLang): string =>
    l === 'en' ? `Another of ${senderName}'s contacts has acknowledged the emergency and is responding. Coordinate if you can help too.`
               : `${senderName} 的另一位亲友已确认这次紧急求助并开始响应。若你也能帮忙，请与其协调。`,
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
  // 紧急联系人查看了你的紧急医疗信息 → 通知本人（特殊类别健康数据的**访问透明/问责**，对标"新登录提醒"）。
  // 只在真被查看时发；很可能是在紧急协助你时——非告警，信息类（遵守勿扰）。
  medicalInfoViewedTitle: (viewerName: string, l: PushLang): string =>
    l === 'en' ? `${viewerName} viewed your medical info` : `${viewerName} 查看了你的紧急医疗信息`,
  medicalInfoViewedBody: (viewerName: string, l: PushLang): string =>
    l === 'en' ? `${viewerName}, your emergency contact, opened your emergency medical info — likely while helping you.`
               : `你的紧急联系人 ${viewerName} 查看了你的紧急医疗信息——很可能是在协助你时。`,
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
  // 到期前提醒**本人**（防遗忘误报）：dead-man's switch 的头号失败模式是用户忘了确认→亲友被无谓惊动→告警疲劳。
  // 提前 leadMs 给本人一条"快到期了，请报平安或延长"的提示（industry-standard：Kitestring/bSafe/Life360 皆有）。
  safetyCheckinReminderTitle: (l: PushLang): string =>
    l === 'en' ? 'Safety check-in due soon' : '安全报到即将到期',
  safetyCheckinReminderBody: (remainMinutes: number, note: string | undefined, l: PushLang): string => {
    const m = Math.max(1, Math.round(remainMinutes))
    const n = (note ?? '').trim()
    const noteSeg = n ? (l === 'en' ? ` (${n})` : `（${n}）`) : ''
    return l === 'en'
      ? `Your safety check-in${noteSeg} ends in about ${m} min. Confirm you're safe, or extend it — otherwise your contacts will be alerted.`
      : `你的安全报到${noteSeg}约 ${m} 分钟后到期。请确认平安或延长，否则将自动通知你的亲友。`
  },
  safetyCheckinExpiredSelfTitle: (l: PushLang): string =>
    l === 'en' ? 'Safety check-in expired offline' : '安全报到已过期（曾断网）',
  safetyCheckinExpiredSelfBody: (l: PushLang): string =>
    l === 'en'
      ? 'Your safety check-in expired while the service was unreachable, so we did not alert your contacts. If you still need help, please send an SOS now.'
      : '你的安全报到到期时服务暂时无法访问，我们未替你通知亲友。如果你仍需要帮助，请立即手动发起求助。',
  // 账号安全敏感变更通知本人（改密/改邮箱/开关 2FA…）：**未授权变更即时预警**——盗号者一旦改密/关 2FA，
  // 真实用户在自己设备上立刻收到（本人操作则是确认）。industry-standard（各家都"密码已修改"邮件/通知）。
  securityNotice: (event: SecurityEvent, l: PushLang): { title: string; body: string } => {
    const en = l === 'en'
    switch (event) {
      case 'password_changed': return { title: en ? 'Password changed' : '账号密码已修改',
        body: en ? 'Your account password was just changed. If this wasn’t you, reset your password immediately.' : '你的账号密码刚刚被修改。若非本人操作，请立即重置密码。' }
      case 'phone_changed': return { title: en ? 'Account phone changed' : '账号手机号已更改',
        body: en ? 'The phone number on your account was just changed. If this wasn’t you, secure your account now.' : '你的账号手机号刚刚被更改。若非本人操作，请立即处理。' }
      case 'username_changed': return { title: en ? 'Username changed' : '账号用户名已更改',
        body: en ? 'The username (a login ID) on your account was just changed. If this wasn’t you, secure your account now.' : '你的账号用户名（登录标识）刚刚被更改。若非本人操作，请立即处理。' }
      case 'apple_linked': return { title: en ? 'Apple sign-in linked' : '已绑定 Apple 登录',
        body: en ? 'An Apple ID sign-in method was just added to your account. If this wasn’t you, unlink it and secure your account now.' : '你的账号刚刚新增了 Apple 登录方式。若非本人操作，请立即解绑并处理账号安全。' }
      case 'apple_unlinked': return { title: en ? 'Apple sign-in removed' : '已解绑 Apple 登录',
        body: en ? 'An Apple ID sign-in method was just removed from your account. If this wasn’t you, secure your account now.' : '你的账号刚刚解绑了 Apple 登录方式。若非本人操作，请立即处理。' }
      case 'passkey_added': return { title: en ? 'Passkey added' : '已新增通行密钥',
        body: en ? 'A passkey (a passwordless sign-in method) was just added to your account. If this wasn’t you, remove it and secure your account now.' : '你的账号刚刚新增了一把通行密钥（免密登录方式）。若非本人操作，请立即删除并处理账号安全。' }
      case 'passkey_removed': return { title: en ? 'Passkey removed' : '已删除通行密钥',
        body: en ? 'A passkey sign-in method was just removed from your account. If this wasn’t you, secure your account now.' : '你的账号刚刚删除了一把通行密钥。若非本人操作，请立即处理。' }
      case 'admin_password_reset': return { title: en ? 'Password reset by an administrator' : '管理员重置了你的密码',
        body: en ? 'An administrator reset your account password and signed you out of all devices. If you didn’t request this, contact us immediately.' : '管理员重置了你的账号密码，你已被登出所有设备。若非你本人请求，请立即联系我们并检查账号安全。' }
      case 'admin_passkey_cleared': return { title: en ? 'Passkeys cleared by an administrator' : '管理员清除了你的通行密钥',
        body: en ? 'An administrator removed all passkeys from your account; you’ll need to re-register them. If you didn’t request this, contact us immediately.' : '管理员清除了你账号上的全部通行密钥，需重新登记。若非你本人请求，请立即联系我们并检查账号安全。' }
      case 'admin_apple_unlinked': return { title: en ? 'Apple sign-in unlinked by an administrator' : '管理员解绑了你的 Apple 登录',
        body: en ? 'An administrator unlinked Apple sign-in from your account. If you didn’t request this, contact us immediately.' : '管理员解绑了你账号的 Apple 登录方式。若非你本人请求，请立即联系我们并检查账号安全。' }
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
