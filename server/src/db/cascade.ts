import type { Store } from './store'

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
  store.deleteUser(id)
}
