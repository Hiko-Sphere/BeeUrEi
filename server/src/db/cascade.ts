import type { Store } from './store'
import { removeKycBlob } from '../kyc/storage'

/// 删除一个用户时的级联清理（账号自删与管理员删号共用，保证数据一致、不留孤儿）。
/// 处理：群（自己建的解散、参与的退出）→ 消息（单聊双向 + 群内发言）→ 绑定 → Passkey → 会话 → 用户本体。
/// 刻意保留：警告/举报等审核与审计记录（用 nameOf 兜底显示 '—'，留存合规证据；删除会破坏可追责性）。
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
  // 实名认证（KYC）：删号即清除该用户的证件密文文件（最敏感 PII）。
  // 法务保留(legalHold)的记录与其证据刻意保留（取证），其余连记录带磁盘密文一并清除。
  for (const v of store.allVerifications()) {
    if (v.userId !== id || v.legalHold) continue
    for (const b of v.blobs ?? []) removeKycBlob(b.blobId)
  }
  store.deleteVerificationsForUser(id) // 跳过 legalHold 行
  store.deleteUser(id)
}
