import Foundation

/// 点钞累加器（纯逻辑，可单测）：数一叠现金时逐张计入面额、报运行总额（对标 Cash Reader / Seeing AI 的"点钞"）。
/// 盲人靠手感分不清面额、更算不清一叠钱多少——逐张扫、听"加 50 元，共 150 元"，最后听总额。
/// 只计**确定**识别的面额（不确定的不入账——钱数错是真金白银）。以「分」为内部单位避免浮点误差（元×100、角×10）。
/// 保留每张的分值栈以支持**撤销**（误扫/同一张扫两次时减掉上一张）。
public struct CashCounter: Sendable, Equatable {
    private var notesFen: [Int] = []

    public init() {}

    /// 已计入总额（分）。
    public var totalFen: Int { notesFen.reduce(0, +) }
    /// 已计入张数。
    public var count: Int { notesFen.count }
    public var isEmpty: Bool { notesFen.isEmpty }

    /// 计入一张：denomination=面额数值，jiao=是否"角"（元×100 分、角×10 分）。非正面额忽略（脏输入不入账）。
    public mutating func add(denomination: Int, jiao: Bool) {
        guard denomination > 0 else { return }
        notesFen.append(jiao ? denomination * 10 : denomination * 100)
    }

    /// 撤销最近计入的一张（防误扫/重复扫）。返回被撤销的分值；无可撤时返回 nil、不改变状态。
    @discardableResult
    public mutating func undoLast() -> Int? {
        notesFen.popLast()
    }

    /// 清零重新数。
    public mutating func reset() { notesFen.removeAll() }
}
