import type { Store } from '../db/store'
import { openField, type Sealed } from '../kyc/crypto'

/// 位置消息载荷（text 里的 JSON `{lat,lng,name?}`）→ 结构化坐标，供自助导出。校验经纬度真实有界
/// （与 messages 路由的 locationSchema 同口径），坏数据/非位置一律返回 null（不吐可疑内容进下载）。
function parseLocationPayload(text: string): { lat: number; lng: number; name: string | null } | null {
  try {
    const p = JSON.parse(text) as { lat?: unknown; lng?: unknown; name?: unknown }
    if (typeof p?.lat !== 'number' || typeof p?.lng !== 'number') return null
    if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng)) return null
    if (p.lat < -90 || p.lat > 90 || p.lng < -180 || p.lng > 180) return null
    return { lat: p.lat, lng: p.lng, name: typeof p.name === 'string' ? p.name : null }
  } catch { return null }
}

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
      quietHours: u.quietHours ?? null, // 勿扰时段设置（本人配置，GDPR 访问覆盖）
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
    // 实名认证（KYC）元数据：本人提交的身份数据属本人 PII，GDPR 访问/可携权覆盖，此前导出漏了。
    // **只导出元信息**（状态/证件类型/尾4位[模型标注非PII]/时间/拒绝码/次数）；姓名与完整证件号以 AES-256
    // 密文留存，**绝不在导出里解密**（数据最小化——用户本就知道自己的姓名/证件号，落一份明文进下载得不偿失）。
    kyc: (() => {
      const v = store.latestVerificationForUser(id)
      if (!v) return null
      return {
        status: v.status, idType: v.idType, idLast4: v.idLast4 ?? null,
        submittedVia: v.submittedVia, submittedAt: v.submittedAt, decidedAt: v.decidedAt ?? null,
        rejectReasonCode: v.rejectReasonCode ?? null, attempt: v.attempt,
        consentVersion: v.consentVersion ?? null,
        legalNameOnFile: !!v.nameSealed, // 姓名以密文留存（true=在档），不解密导出
      }
    })(),
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
    // 常用地点（家/公司/自定义）：本人独有 PII（含住址与坐标）——GDPR 访问/可携权覆盖。与路线同为
    // 位置敏感数据，**仅自助版**（admin 代办导出不含，免管理员随手看到用户家庭住址）。
    savedPlaces: store.savedPlacesForUser(id).map((p) => ({ label: p.label, address: p.address, lat: p.lat ?? null, lng: p.lng ?? null, updatedAt: p.updatedAt })),
    // 安全报到历史（备注/时长/状态）：本人独有数据，含出行备注可能敏感，仅自助版。
    safetyTimers: store.safetyTimersForUser(id).map((t) => ({ note: t.note ?? null, startedAt: t.startedAt, dueAt: t.dueAt, status: t.status,
      firedAt: t.firedAt ?? null, completedAt: t.completedAt ?? null, canceledAt: t.canceledAt ?? null })),
    // 紧急医疗信息（特殊类别健康数据）：本人自填的明文，GDPR 访问/可携权覆盖。**仅自助版**（admin 代办导出绝不含
    // 用户健康数据）。落库是密文，导出前解密还给本人；解密失败则省略（不吐错误内容）。
    medicalInfo: (() => {
      const rec = store.getMedicalInfo(id)
      if (!rec) return null
      try { return { text: openField(JSON.parse(rec.sealed) as Sealed, { submissionId: id, kind: 'medical_info' }), updatedAt: rec.updatedAt } }
      catch { return null }
    })(),
    // 本人的紧急事故记录（摔倒/车祸/SOS）：坐标是本人的、通知计数是本人事件的——完整可携。
    emergencyEvents: store.emergencyEventsForUser(id).map((e) => ({ kind: e.kind, lat: e.lat ?? null, lon: e.lon ?? null,
      locSource: e.locSource ?? null, notified: e.notified, contacts: e.contacts, at: e.at, resolvedAt: e.resolvedAt ?? null })),
    messagesSent: store.messagesSentBy(id, 5000).map((m) => ({
      to: m.groupId ? `group:${m.groupId}` : nameOf(m.toId),
      kind: m.kind,
      text: m.kind === 'text' ? m.text : null, // 图片/视频/语音是 data URL/mediaId，只给元信息不内联
      // 位置消息的坐标是**本人自己分享的位置**（本人 PII，非他人数据），且体积极小（无 data URL 顾虑）——
      // 纳入可携权，否则用户导出里只剩"我发过一条位置"却查不到发的是哪里，可携权不完整。解析失败则省略。
      location: m.kind === 'location' ? parseLocationPayload(m.text) : null,
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
