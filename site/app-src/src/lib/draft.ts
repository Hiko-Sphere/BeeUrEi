/// 会话草稿的本地键与读取（单一事实源：Thread 写入与会话列表"[草稿]"标示共用，防键格式漂移）。
/// 按 **当前用户 + 会话** 命名空间：同一浏览器换账号不串读别人的草稿（隐私）。
export const draftKey = (userId: string | undefined, kind: 'peer' | 'group', id: string): string =>
  `beeurei:draft:${userId ?? 'anon'}:${kind}:${id}`

/// 该会话的未发送草稿（trim 后非空才算；读失败/隐私模式一律 null——列表标示是锦上添花，绝不抛错）。
/// 会话列表据此显示"[草稿] …"前缀（WhatsApp/Telegram 标配）：没写完的话从列表一眼可见，不再被最后一条消息盖住。
export function draftPreview(userId: string | undefined, kind: 'peer' | 'group', id: string): string | null {
  try {
    const v = localStorage.getItem(draftKey(userId, kind, id))
    return v && v.trim() ? v : null
  } catch { return null }
}
