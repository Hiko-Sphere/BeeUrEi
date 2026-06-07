import Foundation

/// 录制知情同意判定（见 PLAN §14 Q6）：录制需**所有参与方**都同意。
public struct RecordingConsent: Sendable {
    public init() {}

    public func allConsented(parties: [String], consented: Set<String>) -> Bool {
        !parties.isEmpty && parties.allSatisfy { consented.contains($0) }
    }
}
