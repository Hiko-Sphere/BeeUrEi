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

    /// 电话号 → tel URL 字符串。只保留数字与前导 +（空格/连字符/括号是常见输入，直接插值会让
    /// URL(string:) 返回 nil——亲友页现拨号入口即有此隐患）；净化后不足 3 位视为不可拨返回 nil。
    public static func telURLString(_ raw: String) -> String? {
        var digits = raw.filter { $0.isNumber }
        if raw.trimmingCharacters(in: .whitespaces).hasPrefix("+") { digits = "+" + digits }
        guard digits.filter({ $0.isNumber }).count >= 3 else { return nil }
        return "tel://\(digits)"
    }
}
