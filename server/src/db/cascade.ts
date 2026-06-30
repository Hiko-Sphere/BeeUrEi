import type { Store } from './store'
import { removeKycBlob } from '../kyc/storage'

/// 删除一个用户时的级联清理（账号自删与管理员删号共用，保证数据一致、不留孤儿）。
/// 处理：群（自己建的解散、参与的退出）→ 消息（单聊双向 + 群内发言）→ 绑定 → Passkey → 会话
///   → 黑名单（任一方向）→ 站内通知 → KYC → 用户本体。
/// 刻意保留：警告/举报等审核与审计记录（用 nameOf 兜底显示 '—'，留存合规证据；删除会破坏可追责性）；
///   通话录制亦保留（可为举报证据，且有独立留存策略）。
export function cascadeDeleteUser(store: Store, id: string): void {
  for (const g of store.groupsFor(id)) {
    if (g.ownerId === id) store.deleteGroup(g.id) // 群主删号 → 解散（连带群消息/已读）
    else store.updateGroup(g.id, { memberIds: g.memberIds.filter((m) => m !== id) }) // 成员删号 → 退群
  }
  store.deleteMessagesForUser(id)
  for (const l of store.linksByOwner(id)) store.deleteLink(l.id)
  for (const l of store.linksByMember(id)) store.deleteLink(l.id)
  for (const pk of store.passkeysForUser(id)) store.deletePasskey(pk.id, id)
  store.deleteRefreshTokensForUser(id)
  // 拉黑记录（任一方向）：删号即清除，否则被删用户 id 永久残留在他人黑名单里（孤儿数据 + 抹除不彻底）。
  // 黑名单非证据，无保留必要（与举报/审计记录不同）。
  for (const b of store.blocksInvolving(id)) store.deleteBlock(b.id)
  // 该用户的站内通知（个人收件箱）：人已删，通知无主，连带清除（GDPR 抹除）。
  store.deleteNotificationsForUser(id)
  // 实名认证（KYC）：删号即清除该用户的证件密文文件（最敏感 PII）。
  // 法务保留(legalHold)的记录与其证据刻意保留（取证），其余连记录带磁盘密文一并清除。
  for (const v of store.allVerifications()) {
    if (v.userId !== id || v.legalHold) continue
    for (const b of v.blobs ?? []) removeKycBlob(b.blobId)
  }
  store.deleteVerificationsForUser(id) // 跳过 legalHold 行
  store.deleteUser(id)
}
