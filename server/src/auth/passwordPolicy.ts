/// 口令策略（NIST 800-63B 口径）：**长度下限 + 常见弱口令拒绝**，刻意不搞字符类别硬性要求
/// （强制"大小写+数字+符号"已被证伪：用户以可预测方式满足规则，实际熵不升反降，NIST 明确不建议）。
/// 上限 128 保留（passphrase 友好；防超长哈希 DoS）。策略单点：注册/改密/管理员代设/找回四路共用。
///
/// 只影响**新设**的密码：登录路径不做强度校验——既有 6-7 位老密码照常可登录，不锁死任何人；
/// 其下一次改密自然升级到新标准（免迁移）。
const MIN_LENGTH = 8
export const MAX_PASSWORD_LENGTH = 128

/// 常见弱口令表（小写比对）：全球高频榜 + 键盘走位 + 中文语境高频（手机号段/吉利数/拼音短语）。
/// 刻意保持精简（数百级、启动零成本）——挡住的是自动化撞库字典的头部，不是全部字典；
/// 主防线仍是限流 + 可选 2FA/Passkey。
const COMMON = new Set([
  // 全球榜头部
  '12345678', '123456789', '1234567890', 'password', 'password1', 'password123', 'passw0rd',
  'qwertyuiop', 'qwerty123', 'iloveyou', 'sunshine', 'princess', 'football', 'baseball',
  'superman', 'batman', 'trustno1', 'welcome1', 'shadow123', 'monkey123', 'dragon123',
  '11111111', '00000000', '88888888', '66666666', '12341234', '12344321', '87654321',
  'abcd1234', 'abc12345', 'a1234567', 'aa123456', 'admin123', 'root1234', 'user1234',
  'letmein1', 'whatever', 'q1w2e3r4', 'q1w2e3r4t5', '1q2w3e4r', '1qaz2wsx', 'zaq12wsx',
  'asdfghjkl', 'asdf1234', 'zxcvbnm1', 'qazwsxedc', 'password!', 'p@ssw0rd', 'p@ssword',
  'welcome123', 'michael1', 'jordan23', 'harley123', 'charlie1', 'donald123', 'freedom1',
  'starwars', 'computer', 'internet', 'samsung1', 'apple123', 'google123',
  // 中文语境高频
  'woaini123', 'wo ai ni', 'woaini520', 'woaini1314', '5201314a', 'a5201314', '520131400',
  '1314520a', 'aini1314', 'qq123456', 'qq123456789', 'wang123456', 'zhang123456', 'li123456',
  'abc123456', '123456abc', '123456aa', '123456qq', '123abc123', 'a123456789', '123456789a',
  '111111aa', '123123123', '321321321', '112233445566', '123321123', 'asd123456',
  'woshishui', 'nihao123', 'buzhidao', 'wangyi123', 'shanghai123', 'beijing123',
])

export type PasswordPolicyError = 'password_too_short' | 'password_too_common' | 'password_too_similar'

/// 设密上下文（NIST 800-63B §5.1.1.2：拒绝含**服务名/用户名/邮箱**等可预测词的口令——把自己的用户名当密码
/// 是最易被针对性猜中的弱凭证，却能过长度+常见表两关）。四路设密各自传入其已知的身份字段。
export interface PasswordContext {
  username?: string
  email?: string
}

/// 上下文词元：应用名 'beeurei' 恒含；**用户名门槛 3**（与用户名下限一致——用户名是公开可猜标识，
/// 把它当密码正是要防的）；**邮箱本地部分门槛 4**（避免过短片段带来的误报）。
function contextTokens(ctx: PasswordContext): string[] {
  const toks = new Set<string>(['beeurei'])
  const u = ctx.username?.toLowerCase().trim()
  if (u && u.length >= 3) toks.add(u)
  const e = ctx.email?.toLowerCase().trim()
  if (e) {
    if (e.length >= 4) toks.add(e)
    const at = e.indexOf('@')
    if (at >= 4) toks.add(e.slice(0, at)) // 邮箱本地部分（≥4）
  }
  return [...toks]
}

/// 口令是否与身份字段过于相似。**锚定/占比匹配**而非裸子串——否则 info/mark/user 等常见 4-5 字母片段
/// 会一刀切拒掉强口令、把正常用户（尤其 VoiceOver 用户）莫名锁在门外（对抗复审 HIGH）。规则：
///  ① 口令==身份字段，或**去首尾数字/符号后的字母核**==身份字段（抓 "alice2026"/"2026alice" 这类派生）；
///  ② 口令是更长身份字段（如长邮箱本地部分）的子串；
///  ③ 含**足够长(≥8)**的身份字段为子串（短片段不子串匹配，避免误报）。
function tooSimilar(lower: string, ctx: PasswordContext): boolean {
  const core = lower.replace(/^[^a-z一-鿿]+|[^a-z一-鿿]+$/g, '') // 去首尾数字/符号的字母核
  return contextTokens(ctx).some((tok) =>
    lower === tok || core === tok ||
    (tok.length >= lower.length && tok.includes(lower)) ||
    (tok.length >= 8 && lower.includes(tok)),
  )
}

/// 平凡低熵结构：全同字符 / 单调递增或递减序列 / 短单元重复填满。这些"够长却极好猜"的口令有无穷变体、
/// 常见弱口令表挡不全，用结构判定兜住。归类 password_too_common（对用户即"太好猜、换一个"）。
export function trivialPattern(s: string): boolean {
  if (/^(.)\1*$/.test(s)) return true // 全同字符 aaaaaaaa / 77777777
  let asc = true, desc = true
  for (let i = 1; i < s.length; i++) {
    const d = s.charCodeAt(i) - s.charCodeAt(i - 1)
    if (d !== 1) asc = false
    if (d !== -1) desc = false
  }
  if (asc || desc) return true // 12345678 / abcdefgh / 87654321
  for (let unit = 1; unit <= 4; unit++) { // 短单元重复 ≥3 次填满：abcabcabc / 12121212（重复 2 次不算，免误伤）
    if (s.length % unit === 0 && s.length / unit >= 3 && s.slice(0, unit).repeat(s.length / unit) === s) return true
  }
  return false
}

/// 返回违规原因；null=通过。顺序：长度 → 常见表 → 平凡结构 → 上下文相似（各自客户端提示更准）。
/// ctx 可选：只在能拿到身份字段的设密路径传入（注册/改密/找回/管理员代设）。
export function passwordPolicyError(pw: string, ctx?: PasswordContext): PasswordPolicyError | null {
  if (pw.length < MIN_LENGTH) return 'password_too_short'
  const lower = pw.toLowerCase()
  if (COMMON.has(lower)) return 'password_too_common'
  if (trivialPattern(lower)) return 'password_too_common'
  if (ctx && tooSimilar(lower, ctx)) return 'password_too_similar'
  return null
}
