import Foundation

/// 座位占用判定（找空座位）：座位框（椅子/沙发）与人框的几何交叠 → 空着 / 可能有人。
/// 纯几何、无状态、可单测——对齐 Apple Magnifier「Announce Seat Occupancy」（其锁 LiDAR Pro 机型；
/// 本实现纯 2D 框几何，任何能跑检测模型的机型都可用）。
///
/// 保守原则：误报"有人"仅是多找一把椅子的不便；误报"空着"会让盲人去坐已占的座位（社交成本高）——
/// 故交叠阈值放低（人框交叠占**座位框**面积 ≥ minOverlapRatio 即"可能有人"），退化/非有限座位框一律不敢说"空"。
/// 用"交叠占座位面积比"而非 IoU：坐着的人框（含头/躯干）远大于椅面且大半在椅框之上，IoU 会被人框面积稀释而漏报。
public enum SeatOccupancy {
    public enum Verdict: Equatable, Sendable {
        case free           // 未见与座位显著交叠的人 → "看起来空着"
        case maybeOccupied  // 有人框显著压住座位框 → "可能有人"（保守措辞：遮挡/贴邻场景可能误报）
    }

    /// 座位框对人框列表做占用判定。各框须在同一归一化坐标系（几何比例与原点朝向无关）。
    public static func judge(seat: NormalizedBox, persons: [NormalizedBox], minOverlapRatio: Double = 0.22) -> Verdict {
        // 退化/非有限座位框：无从判定，绝不声称"空着"（非有限输入镜头：每个消费者都显式守护）。
        guard seat.x.isFinite, seat.y.isFinite, seat.width.isFinite, seat.height.isFinite,
              seat.width > 0, seat.height > 0 else { return .maybeOccupied }
        let seatArea = seat.width * seat.height
        for p in persons {
            // 坏人框跳过（NaN 参与比较恒 false，本就不会误命中；显式守护防重构复发）。
            guard p.x.isFinite, p.y.isFinite, p.width.isFinite, p.height.isFinite,
                  p.width > 0, p.height > 0 else { continue }
            let ox = max(0, min(seat.x + seat.width, p.x + p.width) - max(seat.x, p.x))
            let oy = max(0, min(seat.y + seat.height, p.y + p.height) - max(seat.y, p.y))
            if ox * oy / seatArea >= minOverlapRatio { return .maybeOccupied }
        }
        return .free
    }

    /// 多把候选座位里的**优先选座**（纯逻辑，可单测）：盲人说"找空座位"要的是被指向一把**空**椅，
    /// 而非画面里最显眼但**已占**的那把（坐到别人身上社交成本高）。规则：先在**看起来空着**的座位里取
    /// 置信度最高的那把；若全部"可能有人"，退回置信度最高的那把（如实报"可能有人"，不谎报空）。
    /// 空候选/座位框全非有限 → nil（无从指路，绝不硬指）。非有限置信度当 0（不因坏读数抢占）。
    public static func pickSeatIndex(seats: [(box: NormalizedBox, confidence: Double)],
                                     persons: [NormalizedBox], minOverlapRatio: Double = 0.22) -> Int? {
        var bestFree: (idx: Int, conf: Double)?
        var bestAny: (idx: Int, conf: Double)?
        for (i, s) in seats.enumerated() {
            let conf = s.confidence.isFinite ? s.confidence : 0
            if bestAny == nil || conf > bestAny!.conf { bestAny = (i, conf) }
            if judge(seat: s.box, persons: persons, minOverlapRatio: minOverlapRatio) == .free,
               bestFree == nil || conf > bestFree!.conf {
                bestFree = (i, conf)
            }
        }
        return (bestFree ?? bestAny)?.idx
    }
}
