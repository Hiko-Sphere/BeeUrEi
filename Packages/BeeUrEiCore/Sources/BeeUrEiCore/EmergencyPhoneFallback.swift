import Foundation

/// 无网兜底拨号（纯逻辑，可单测）：紧急告警在**完全没有数据网络**时（5 次退避重试全败）
/// 走蜂窝语音兜底——tel: 拨打紧急联系人的真实电话不依赖数据网络。亲友绑定的 phone 字段
/// 正是为此存在（"电话兜底"），此前只在亲友页手动可拨，告警失败路径从未接上。
public enum EmergencyPhoneFallback {
    public struct Candidate: Sendable, Equatable {
        public let name: String
        public let phone: String
        public let isEmergency: Bool
        public let isAccepted: Bool
        public init(name: String, phone: String, isEmergency: Bool, isAccepted: Bool) {
            self.name = name
            self.phone = phone
            self.isEmergency = isEmergency
            self.isAccepted = isAccepted
        }
    }

    /// 从亲友列表挑兜底拨号对象：仅 accepted 且电话可拨者；紧急联系人优先；同层级保持输入序
    /// （调用方传入的列表已是服务端稳定序）。无可拨对象返回 nil（调用方只播报"请直接呼叫求助"）。
    public static func pick(_ candidates: [Candidate]) -> Candidate? {
        let usable = candidates.filter { $0.isAccepted && telURLString($0.phone) != nil }
        return usable.first(where: { $0.isEmergency }) ?? usable.first
    }

    /// 电话号 → tel URL 字符串。只保留**阿拉伯数字**与前导 +（空格/连字符/括号是常见输入，直接插值会让
    /// URL(string:) 返回 nil——亲友页现拨号入口即有此隐患）；净化后不足 3 位视为不可拨返回 nil。
    ///
    /// ⚠️ 必须用 `isASCII && isNumber`，不能用裸 `isNumber`：Swift 的 `Character.isNumber` 对**全角数字
    /// （１２３，从中文网页复制电话号极常见）/中文数字/阿拉伯-印度数字**也为 true，这些字符进 `tel://`
    /// iOS **无法拨号**。此路径是**无数据网时的最后兜底拨号**，宁可净化后返回 nil 让调用方播报"请直接
    /// 呼叫求助"，也绝不生成一个拨不出去的 URL。（与 CurrencyClassifier/BusDisplayReader 同根的 isNumber 坑。）
    public static func telURLString(_ raw: String) -> String? {
        func isAsciiDigit(_ ch: Character) -> Bool { ch.isASCII && ch.isNumber }
        var digits = raw.filter(isAsciiDigit)
        // whitespacesAndNewlines：`.whitespaces` 只含空格/制表符，前导**换行/回车**（多行联系人粘贴常见）会
        // 让 hasPrefix("+") 落空、国家码 + 被丢，生成拨不通的错号——正是本兜底路要防的假安心（对抗复审 LOW）。
        if raw.trimmingCharacters(in: .whitespacesAndNewlines).hasPrefix("+") { digits = "+" + digits }
        guard digits.filter(isAsciiDigit).count >= 3 else { return nil }
        return "tel://\(digits)"
    }
}
