import Foundation

/// 紧急告警位置的诚实标注（纯逻辑，可单测；与网页端 `lib/emergencyLoc.ts` 同一语义，两端口径一致）。
///
/// 服务端在告警缺实时定位时会兜底附「最后已知共享位置」，并在通知 data 里标
/// `locSource: "lastKnown"` + `locAgeSec`（定位距告警发出时的秒数）。渲染位置链接时**必须区分**：
/// 把 15 分钟前的最后已知位置伪装成实时定位，会让协助者/亲友赶去错误地点。
///
/// 定位时刻用**绝对时间**（= 告警时刻 − ageSec），而非"N 分钟前"相对措辞——通知可能在数小时后
/// 才被看到，相对措辞会随阅读时刻漂移成谎言；绝对时刻永远为真。
public enum EmergencyLocationTag {
    public struct Info: Equatable, Sendable {
        /// 是否为「最后已知」兜底位置（非告警时刻的实时定位）。
        public let stale: Bool
        /// 定位时刻（ms since epoch）；仅 stale 且 ageSec 可解析时给出，供渲染"最后已知位置 · HH:MM"。
        public let fixAtMs: Double?
        public init(stale: Bool, fixAtMs: Double?) {
            self.stale = stale
            self.fixAtMs = fixAtMs
        }
    }

    /// - Parameters:
    ///   - data: 通知的 data 字典（服务端告警通知的 locSource/locAgeSec 在其中）。
    ///   - createdAtMs: 告警通知创建时刻（ms）。
    public static func info(data: [String: String]?, createdAtMs: Double) -> Info {
        guard let data, data["locSource"] == "lastKnown" else { return Info(stale: false, fixAtMs: nil) }
        // ageSec 缺失/坏值/负值：仍如实标"最后已知"（stale 不依赖时效解析），只是不给定位时刻。
        guard let s = data["locAgeSec"], let age = Double(s), age.isFinite, age >= 0,
              createdAtMs.isFinite else { return Info(stale: true, fixAtMs: nil) }
        return Info(stale: true, fixAtMs: createdAtMs - age * 1000)
    }
}
