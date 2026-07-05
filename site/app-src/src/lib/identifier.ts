// 标识符类型判定。用于**加好友**（Family：邮箱/手机号先 lookup 拿 userId，纯用户名直接提交）
// 与提示类展示；**登录不再据此拆字段**——登录一律把标识作 username 传，服务端 findByLoginIdentifier
// 单字段解析（见 api.ts buildLoginBody；此前按类型拆 email/phone 字段致邮箱/手机号登录 400）。
//  email：含 '@'
//  phone：去掉空格/连字符/括号/点后是 +? 加 ≥5 位数字（按"实际数字位数"判定，比"含分隔符总长≥5"更准）
//  否则：username
// ⚠️ 分隔符集须与服务端 normalizePhone(auth/apple.ts) 一致——否则如 "(305) 555-0199" 客户端因括号判成
// username、直接按用户名提交而不走 lookup，但服务端本能归一化括号手机号并查到人（客户端漏路由到 lookup）。
export type IdentifierKind = 'email' | 'phone' | 'username'

export function normalizePhoneInput(raw: string): string {
  return raw.replace(/[\s().-]/g, '')
}

export function classifyIdentifier(raw: string): IdentifierKind {
  if (raw.includes('@')) return 'email'
  if (/^\+?[0-9]{5,}$/.test(normalizePhoneInput(raw))) return 'phone'
  return 'username'
}
