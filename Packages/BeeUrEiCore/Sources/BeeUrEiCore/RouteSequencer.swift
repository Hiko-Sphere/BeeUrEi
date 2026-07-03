import Foundation

/// 多步路线推进编排（纯逻辑，可单测）——把已各自验证的零件串成一个转向序列状态机：
/// `WaypointAdvance`（越过波谷推进判定）+ `RouteProgress`（精度门控的转向播报）+ `Geo`（距离）。
/// 喂入当前位置与定位精度等级，输出「当前目标是第几个转向 / 播报什么 / 是否越过并推进 / 是否到达终点」。
///
/// 背景：这套推进逻辑此前内嵌在设备层 `NavigationViewModel`（未单测），零件虽各自已测、串接却没有回归。
/// 提取为纯核心后可脱离设备覆盖全部编排分支：正常推进、走完转向后直奔终点、到达的精度门控、
/// 偏航汇入跳转。副作用（空间音信标/触觉/沿途地标/路名地理编码）仍留设备层，本组件只做「决策」。
///
/// 安全不变量（与设备层一致）：
/// - **到达是高确定性结论，必须过精度门控**：仅 `.precise` 才宣布到达并终止；否则只报"接近"，
///   不终止导航（防低精度下单帧 GPS 抖进半径就误报到达、永久停下，见设备层审查 #1）。
/// - **推进只在精度可信（非 `.none`）时进行**：`.none` GPS 噪声过大，几何推进不可靠，暂停待恢复
///   （否则抖动可能"无声吞掉"一个转向点）。
public struct RouteSequencer: Sendable {
    /// 一个转向点：坐标 + 指令文本。
    public struct Maneuver: Sendable, Equatable {
        public let coordinate: Coordinate
        public let instruction: String
        public init(coordinate: Coordinate, instruction: String) {
            self.coordinate = coordinate
            self.instruction = instruction
        }
    }

    /// 一次位置更新后的编排决策。target/distance/announcement/stepIndex 一致地描述**本帧正在趋近的**
    /// 那个转向点（推进发生在其后）；`advanced` 表示本帧已越过它，下一帧起 `RouteSequencer.stepIndex`
    /// 指向下一个。
    public struct Decision: Sendable, Equatable {
        /// 本帧目标转向索引；== maneuvers.count 表示已走完全部转向、正直奔终点。
        public let stepIndex: Int
        /// 本帧目标坐标（当前转向点，或走完后为终点）。
        public let target: Coordinate
        /// 到本帧目标的距离（米）。非有限输入时为 .infinity。
        public let distanceToTargetMeters: Double
        /// 本帧为当前转向生成的播报（直奔终点/已到达时为 .silent）。
        public let announcement: ManeuverAnnouncement
        /// 本帧是否越过当前转向点并推进到下一索引。调用方据此清空语音去重基线。
        public let advanced: Bool
        /// 已到达终点（走完全部转向 + 进入到达半径 + 高精度）。为 true 时调用方应停止导航。
        public let arrived: Bool
        /// 进入到达半径但精度不足：接近但不宣布到达（不终止导航，等精度恢复）。
        public let approachingDestination: Bool

        public init(stepIndex: Int, target: Coordinate, distanceToTargetMeters: Double,
                    announcement: ManeuverAnnouncement, advanced: Bool,
                    arrived: Bool, approachingDestination: Bool) {
            self.stepIndex = stepIndex
            self.target = target
            self.distanceToTargetMeters = distanceToTargetMeters
            self.announcement = announcement
            self.advanced = advanced
            self.arrived = arrived
            self.approachingDestination = approachingDestination
        }
    }

    public let destination: Coordinate
    public let arrivalRadiusMeters: Double
    private let maneuvers: [Maneuver]
    private let progress: RouteProgress
    private var waypointAdvance: WaypointAdvance
    private(set) public var stepIndex: Int = 0

    public init(maneuvers: [Maneuver], destination: Coordinate,
                arrivalRadiusMeters: Double = 15,
                progress: RouteProgress = RouteProgress(),
                waypointAdvance: WaypointAdvance = WaypointAdvance()) {
        self.maneuvers = maneuvers
        self.destination = destination
        self.arrivalRadiusMeters = max(0, arrivalRadiusMeters)
        self.progress = progress
        self.waypointAdvance = waypointAdvance
    }

    public var maneuverCount: Int { maneuvers.count }
    /// 已走完全部转向（正直奔终点；**不代表已到达**——到达还需进入半径且高精度）。
    public var isHeadingToDestination: Bool { stepIndex >= maneuvers.count }

    /// 偏航汇入等外部决策后，跳到指定转向索引并重置越过判定基线。索引夹到 [0, count]。
    /// （汇入索引由调用方用已测的 `RouteRejoin` 在路线航点上算出——本组件不做偏航检测，只接受跳转。）
    public mutating func jump(to index: Int) {
        stepIndex = min(max(index, 0), maneuvers.count)
        waypointAdvance.reset()
    }

    /// 喂入当前位置与定位精度等级，推进状态机并返回本帧决策。
    public mutating func update(lat: Double, lon: Double, level: InstructionLevel,
                                language: Language = .zh) -> Decision {
        // 已走完全部转向 → 到达判定（精度门控，见类型注释安全不变量）。
        if stepIndex >= maneuvers.count {
            let toDest = Geo.distanceMeters(fromLat: lat, fromLon: lon, toLat: destination.lat, toLon: destination.lon)
            let within = toDest.isFinite && toDest < arrivalRadiusMeters
            let arrived = within && level == .precise
            return Decision(stepIndex: stepIndex, target: destination, distanceToTargetMeters: toDest,
                            announcement: .silent, advanced: false,
                            arrived: arrived, approachingDestination: within && !arrived)
        }

        // 朝当前转向点：算距离 → 播报决策 → （精度可信时）越过则推进。
        let workingIndex = stepIndex
        let m = maneuvers[workingIndex]
        let distance = Geo.distanceMeters(fromLat: lat, fromLon: lon, toLat: m.coordinate.lat, toLon: m.coordinate.lon)
        let announcement = progress.decide(distanceToManeuverMeters: distance, instruction: m.instruction,
                                           level: level, language: language)

        var advanced = false
        if level != .none, distance.isFinite, waypointAdvance.update(distanceMeters: distance) {
            stepIndex += 1
            advanced = true
        }

        return Decision(stepIndex: workingIndex, target: m.coordinate,
                        distanceToTargetMeters: distance.isFinite ? distance : .infinity,
                        announcement: announcement, advanced: advanced,
                        arrived: false, approachingDestination: false)
    }

    /// 开始导航 / 重新规划时调用，回到首个转向点并清空越过基线。
    public mutating func reset() {
        stepIndex = 0
        waypointAdvance.reset()
    }
}
