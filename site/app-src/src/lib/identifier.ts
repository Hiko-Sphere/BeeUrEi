// 登录/加好友共用的标识符类型判定（此前两处内联、且手机号正则略有出入——统一到一处，确保口径一致）。
//  email：含 '@'
//  phone：去掉空格/连字符后是 +? 加 ≥5 位数字（按"实际数字位数"判定，比"含分隔符总长≥5"更准）
//  否则：username
export type IdentifierKind = 'email' | 'phone' | 'username'

export function normalizePhoneInput(raw: string): string {
  return raw.replace(/[\s-]/g, '')
}

export function classifyIdentifier(raw: string): IdentifierKind {
  if (raw.includes('@')) return 'email'
  if (/^\+?[0-9]{5,}$/.test(normalizePhoneInput(raw))) return 'phone'
  return 'username'
}
