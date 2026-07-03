import type { Store } from './store'
import { removeKycBlob } from '../kyc/storage'
import { removeMediaFile } from '../media/storage'

/// 解散群组：先清群内视频消息的磁盘媒体（含他人发的，不留孤儿），再删群（连带群消息/已读）。
/// 群主解散端点与删号级联（群主删号→解散其群）共用此函数，保证两条解散路径口径一致——
/// 否则一路清媒体、另一路漏（曾如此：cascade 直接 deleteGroup 不碰群内视频文件）。
export function dissolveGroup(store: Store, groupId: string): void {
  for (const m of store.groupMessages(groupId, 100_000)) {
    if (m.kind === 'video' && m.text !== '') { store.deleteMedia(m.text); removeMediaFile(m.text) }
  }
  store.deleteGroup(groupId)
}

/// 删除一个用户时的级联清理（账号自删与管理员删号共用，保证数据一致、不留孤儿）。
/// 处理：群（自己建的解散、参与的退出）→ 消息（单聊双向 + 群内发言）→ 该用户上传的媒体文件
///   → 绑定 → Passkey → 会话 → 黑名单（任一方向）→ 站内通知 → KYC → 用户本体。
/// 刻意保留：警告/举报等审核与审计记录（用 nameOf 兜底显示 '—'，留存合规证据；删除会破坏可追责性）；
///   通话录制亦保留（可为举报证据，且有独立留存策略）。
export function cascadeDeleteUser(store: Store, id: string): void {
  for (const g of store.groupsFor(id)) {
    if (g.ownerId === id) dissolveGroup(store, g.id) // 群主删号 → 解散（连带群消息/已读 + 群内视频媒体）
    else store.updateGroup(g.id, { memberIds: g.memberIds.filter((m) => m !== id) }) // 成员删号 → 退群
  }
  // 非群主退群仅改 memberIds、不经 deleteGroup，其在这些群的已读游标(group_reads)会残留成孤儿——
  // 显式清除，兑现"不留孤儿"。群主的群已由 dissolveGroup→deleteGroup 连带清掉，这里重复清也无副作用。
  store.deleteGroupReadsForUser(id)
  store.deleteMessagesForUser(id)
  // 该用户上传的媒体（视频消息文件等）：删号即清磁盘文件 + 元数据，否则视频文件成孤儿、
  // 留存其 PII（cascade 承诺"不留孤儿"；deleteMessagesForUser 只删消息记录不碰磁盘文件）。
  for (const m of store.mediaByOwner(id)) { removeMediaFile(m.id); store.deleteMedia(m.id) }
  for (const l of store.linksByOwner(id)) store.deleteLink(l.id)
  for (const l of store.linksByMember(id)) store.deleteLink(l.id)
  for (const pk of store.passkeysForUser(id)) store.deletePasskey(pk.id, id)
  store.deleteRefreshTokensForUser(id)
  store.deleteRecoveryCodesForUser(id) // 2FA 一次性恢复码（哈希）：删号即清，否则残留无主安全凭据（GDPR 抹除，同通知）
  // 拉黑记录（任一方向）：删号即清除，否则被删用户 id 永久残留在他人黑名单里（孤儿数据 + 抹除不彻底）。
  // 黑名单非证据，无保留必要（与举报/审计记录不同）。
  for (const b of store.blocksInvolving(id)) store.deleteBlock(b.id)
  // 该用户的站内通知（个人收件箱）：人已删，通知无主，连带清除（GDPR 抹除）。
  store.deleteNotificationsForUser(id)
  // 紧急事件日志：人已删，坐标等敏感 PII 随主体抹除（治理留痕由管理员审计日志承担，其不含坐标）。
  store.deleteEmergencyEventsForUser(id)
  store.deleteWebPushSubscriptionsForUser(id) // 浏览器推送订阅：人已删，端点随之清（否则继续空投）
  // 路线库：归属者删号即清其全部路线（亲友替其画的也属其资产，随主体删除）；绘制者删号不影响他人路线。
  store.deleteSavedRoutesForOwner(id)
  // 实名认证（KYC）：删号即清除该用户的证件密文文件（最敏感 PII）。
  // 法务保留(legalHold)的记录与其证据刻意保留（取证），其余连记录带磁盘密文一并清除。
  for (const v of store.allVerifications()) {
    if (v.userId !== id || v.legalHold) continue
    for (const b of v.blobs ?? []) removeKycBlob(b.blobId)
  }
  store.deleteVerificationsForUser(id) // 跳过 legalHold 行
  store.deleteUser(id)
}
