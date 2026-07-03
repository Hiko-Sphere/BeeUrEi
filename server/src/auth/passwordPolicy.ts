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

export type PasswordPolicyError = 'password_too_short' | 'password_too_common'

/// 返回违规原因；null=通过。长度先于常见性（短口令报短，客户端提示更准）。
export function passwordPolicyError(pw: string): PasswordPolicyError | null {
  if (pw.length < MIN_LENGTH) return 'password_too_short'
  if (COMMON.has(pw.toLowerCase())) return 'password_too_common'
  return null
}
