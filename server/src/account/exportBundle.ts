import type { Store } from '../db/store'

/// 用户数据导出的公共构建器（GDPR 可携权）：admin 代办导出与用户自助导出共用同一底座，
/// 防两处口径漂移（尤其"绝不导出密码哈希/令牌"这条安全底线）。
/// 聊天正文刻意不在底座里：admin 版**不含任何正文**（管理员不读消息）；自助版另行追加
/// **本人发出的**文字消息（自己的话属于自己的数据；对方的话不属于——见 selfExtras）。
export function buildUserExportBundle(store: Store, id: string, now: number) {
  const u = store.findById(id)
  if (!u) return null
  const nameOf = (uid: string) => store.findById(uid)?.displayName ?? '—'
  const allReports = store.allReports()
  const involving = store.blocksInvolving(id)
  return {
    exportedAt: now,
    profile: {
      id: u.id, username: u.username, displayName: u.displayName, role: u.role, status: u.status,
      createdAt: u.createdAt, language: u.language ?? null,
      email: u.email ?? null, emailVerified: !!u.emailVerified, phone: u.phone ?? null,
      appleLinked: !!u.appleSub, usernameCustomized: !!u.usernameCustomized,
      legalConsentVersion: u.legalConsentVersion ?? null, legalConsentAt: u.legalConsentAt ?? null,
      hasAvatar: !!u.avatar, featureOverrides: u.featureOverrides ?? {},
    },
    familyLinks: [
      ...store.linksByOwner(id).map((l) => ({ direction: 'owner', other: nameOf(l.memberId), relation: l.relation, isEmergency: l.isEmergency, status: l.status ?? 'accepted', createdAt: l.createdAt })),
      ...store.linksByMember(id).map((l) => ({ direction: 'member', other: nameOf(l.ownerId), relation: l.relation, isEmergency: l.isEmergency, status: l.status ?? 'accepted', createdAt: l.createdAt })),
    ],
    // 群聊归属（与 familyLinks 同为关联数据、非消息正文，admin 版也含）：此前导出漏了群成员关系——
    // 用户能看到"我发给 group:xxx 的消息"却查不到 xxx 是什么群，可携权不完整。补群名/角色/成员数。
    groups: store.groupsFor(id).map((g) => ({ name: g.name, role: g.ownerId === id ? 'owner' : 'member', memberCount: g.memberIds.length, createdAt: g.createdAt })),
    blocks: {
      blocking: involving.filter((b) => b.blockerId === id).map((b) => ({ other: nameOf(b.blockedId), createdAt: b.createdAt })),
      blockedBy: involving.filter((b) => b.blockedId === id).map((b) => ({ other: nameOf(b.blockerId), createdAt: b.createdAt })),
    },
    reports: {
      filedByUser: allReports.filter((r) => r.reporterId === id).map((r) => ({ target: nameOf(r.targetUserId), reason: r.reason, status: r.status, decision: r.decision ?? null, createdAt: r.createdAt })),
      againstUser: allReports.filter((r) => r.targetUserId === id).map((r) => ({ reporter: nameOf(r.reporterId), reason: r.reason, status: r.status, decision: r.decision ?? null, createdAt: r.createdAt })),
    },
    warnings: store.warningsForUser(id).map((w) => ({ reason: w.reason, byAdmin: nameOf(w.byAdminId), at: w.at })),
    recordings: store.allRecordings().filter((r) => r.ownerId === id).map((r) => ({ callId: r.callId, reason: r.reason, recordedAt: r.recordedAt })),
    callRecords: store.callRecordsForUser(id, 1000).map((c) => ({ direction: c.callerId === id ? 'outgoing' : 'incoming', peer: nameOf(c.callerId === id ? c.calleeId : c.callerId), status: c.status, createdAt: c.createdAt })),
    passkeys: store.passkeysForUser(id).map((p) => ({ deviceName: p.deviceName ?? null, createdAt: p.createdAt })),
    activeSessions: store.countSessionsForUser(id, now),
  }
}

/// 自助导出的追加块（只有本人能拿到的部分）：
/// - 本人的路线库（自己的资产，含航点坐标——admin 版无此块）；
/// - **本人发出的**消息：文字含正文（自己的话属于自己的数据）；语音/图片是 data URL、视频是
///   mediaId——只给元信息不内联（体积失控且媒体文件另有下载通道）；对方发来的一概不含
///   （对方的话是对方的数据，可携权不覆盖他人）。
export function buildSelfExportExtras(store: Store, id: string) {
  const nameOf = (uid: string) => store.findById(uid)?.displayName ?? '—'
  return {
    savedRoutes: store.savedRoutesForUser(id).map((r) => ({ name: r.name, waypoints: r.waypoints, createdAt: r.createdAt, updatedAt: r.updatedAt })),
    // 本人的紧急事故记录（摔倒/车祸/SOS）：坐标是本人的、通知计数是本人事件的——完整可携。
    emergencyEvents: store.emergencyEventsForUser(id).map((e) => ({ kind: e.kind, lat: e.lat ?? null, lon: e.lon ?? null,
      locSource: e.locSource ?? null, notified: e.notified, contacts: e.contacts, at: e.at, resolvedAt: e.resolvedAt ?? null })),
    messagesSent: store.messagesSentBy(id, 5000).map((m) => ({
      to: m.groupId ? `group:${m.groupId}` : nameOf(m.toId),
      kind: m.kind,
      text: m.kind === 'text' ? m.text : null, // 非文字只给元信息（data URL/mediaId 不内联）
      createdAt: m.createdAt,
    })),
    // 本人的通知收件箱（收到的告警/好友请求/回执等——是关于本人的数据，GDPR 访问/可携权覆盖）。
    // **仅自助版**：标题/正文含预览文案，admin 不读用户收件箱（同"admin 不含消息正文"口径）。只给
    // 元信息(kind/title/body/时间/已读)，不含 data 载荷（避免把他人坐标等经推送数据二次外泄给收件人导出）。
    notifications: store.notificationsForUser(id, 5000).map((n) => ({
      kind: n.kind, title: n.title, body: n.body, createdAt: n.createdAt, readAt: n.readAt ?? null,
    })),
  }
}
