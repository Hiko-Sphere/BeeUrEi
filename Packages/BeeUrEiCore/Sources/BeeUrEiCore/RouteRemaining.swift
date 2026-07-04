import Foundation

/// 剩余路程 + 预计到达（纯逻辑，可单测）。导航中周期播报「还有约 X 米，预计 Y 分钟」——
/// Soundscape/BlindSquare/Apple/Google 步行导航的行业标配：盲人看不到进度条，剩余里程与 ETA 是
/// 关键的方位感与信心来源（"快到了" vs "还早"决定要不要中途歇脚/确认方向）。
///
/// 设计要点（对齐"真实、非假设"）：
/// - 剩余里程 = 当前点 → 剩余各转向点 → 终点 的折线累距（沿路真实路程，非直线距离）。
/// - ETA 用**真实测得步速**（`CLLocation.speed`，App 层传入），夹到合理步行区间，缺测时才回退默认；
///   绝不用一个凭空假设的固定速度当唯一依据。
/// - 全程 isFinite 守卫（坏 GPS 帧一律返回 nil，"未知不动作"——与 OffRouteDetector/RouteRejoin 同不变量）。
public enum RouteRemaining {
    /// 沿路剩余里程（米）：当前点 → `remainingManeuvers`（stepIndex 起未过的转向点）→ `destination` 的累距。
    /// 任一坐标非有限则返回 nil（坏定位帧不给出可能误导的数字）。
    public static func distanceMeters(currentLat: Double, currentLon: Double,
                                      remainingManeuvers: [Coordinate],
                                      destination: Coordinate) -> Double? {
        guard currentLat.isFinite, currentLon.isFinite else { return nil }
        var total = 0.0
        var prevLat = currentLat, prevLon = currentLon
        for p in remainingManeuvers + [destination] {
            guard p.lat.isFinite, p.lon.isFinite else { return nil }
            let d = Geo.distanceMeters(fromLat: prevLat, fromLon: prevLon, toLat: p.lat, toLon: p.lon)
            guard d.isFinite else { return nil }
            total += d
            prevLat = p.lat; prevLon = p.lon
        }
        return total
    }

    /// 把原始速度（通常来自 `CLLocation.speed`，m/s；无效时为负）夹到合理步行区间。
    /// 无效/缺测 → `defaultMps`（保守默认步速，仅在真的测不到时兜底）。
    /// 夹上限防"坐上公交/被车带走"时算出虚高速度→ETA 失真；夹下限防"等红灯/驻足"时速度≈0→ETA 爆表。
    public static func effectiveWalkingSpeed(rawMps: Double?, defaultMps: Double = 1.2) -> Double {
        guard let raw = rawMps, raw.isFinite, raw > 0 else { return defaultMps }
        return min(max(raw, 0.5), 2.5)   // 0.5–2.5 m/s ≈ 1.8–9 km/h，覆盖慢走到快走
    }

    /// 预计剩余秒数 = 剩余米 / 步速。任一非有限或步速≤0 返回 nil。
    public static func etaSeconds(remainingMeters: Double, speedMps: Double) -> Double? {
        guard remainingMeters.isFinite, remainingMeters >= 0, speedMps.isFinite, speedMps > 0 else { return nil }
        return remainingMeters / speedMps
    }
}

/// 剩余里程里程碑播报判定（纯逻辑，可单测）。像 Google/Apple 导航那样，只在**跨过**某个里程碑
/// （1km/500/200/100/50 米）时报一次，不逐帧刷屏。
///
/// 不变量：
/// - 只在"上一帧还在里程碑之上、这一帧已到/低于它"时触发（**向下跨越**）；起步就已在某里程碑之下的
///   （如全程仅 300 米，1km/500 从未"路过"）不误报。
/// - 每个里程碑一生只报一次（GPS 抖动让剩余里程在里程碑附近来回也不重复报）。
/// - 一帧内若因大跳跨过多个里程碑，只报**最小**（最贴近当前现实）的那个，其余标记为已报不再补。
public struct RemainingDistanceAnnouncer: Sendable {
    public let milestones: [Double]      // 降序、正数、去重
    private var announced: Set<Int> = []
    private var lastRemaining: Double?

    // 末段加 25 米里程碑：50 米之后到"到达"(<15m)之间原本空白，而这正是盲人最想听到"快到了"的一段
    // （放慢脚步、准备找门/确认门牌）。竞品导航同样在最后一程给"即将到达"提示。
    public init(milestones: [Double] = [1000, 500, 200, 100, 50, 25]) {
        self.milestones = Array(Set(milestones.filter { $0 > 0 })).sorted(by: >)
    }

    /// 喂入当前剩余里程（米）。返回刚向下跨过、尚未播报的里程碑（米），否则 nil；一次至多返回一个。
    public mutating func update(remainingMeters: Double) -> Double? {
        guard remainingMeters.isFinite, remainingMeters >= 0 else { return nil }
        defer { lastRemaining = remainingMeters }
        guard let last = lastRemaining else { return nil }   // 首帧只立基线，不报（防起步即报一串已越过的）
        let crossed = milestones.filter { m in
            !announced.contains(Int(m)) && last > m && remainingMeters <= m
        }
        guard !crossed.isEmpty else { return nil }
        for m in crossed { announced.insert(Int(m)) }        // 跨过的全标已报，避免抖动补报
        return crossed.min()                                  // 报最贴近现实的最小里程碑
    }

    /// 新目的地开始导航时调用，清空已报里程碑与基线（同一目的地重规划**不**需重置——已报的仍有效）。
    public mutating func reset() {
        announced.removeAll()
        lastRemaining = nil
    }
}
