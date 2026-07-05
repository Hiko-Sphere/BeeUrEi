import Foundation

/// 到达/离开围栏判定（纯逻辑，可单测；与服务端 evaluateGeofences 同算法、同滞回门槛）。
/// 盲人到"家/公司"时**自身也听"你到家了"**做定向确认——此前只有服务端通知家人、盲人本人无提示。
/// **滞回**避免 GPS 在边界抖动反复触发：之前判"在外"须进入 enterRadius(默认150m) 才算入；
/// 之前判"在内"须离到 exitRadius(默认200m) 外才算出。只对**有坐标**的地点判定；只报"外→内"新到达/"内→外"离开转换。
/// 坐标均 WGS-84（与客户端上报同系）。复用 Geo.distanceMeters（haversine，已测）。
public enum GeofenceEvaluator {
    public struct Place: Equatable, Sendable {
        public let label: String
        public let lat: Double
        public let lng: Double
        public init(label: String, lat: Double, lng: Double) { self.label = label; self.lat = lat; self.lng = lng }
    }
    public struct Result: Equatable, Sendable {
        public let arrived: [String]          // 本次外→内的 label（触发"你到了X"）
        public let departed: [String]         // 本次内→外的 label
        public let insideLabels: Set<String>  // 更新后仍在内（调用方存回，作下次 prevInside）
        public init(arrived: [String], departed: [String], insideLabels: Set<String>) {
            self.arrived = arrived; self.departed = departed; self.insideLabels = insideLabels
        }
    }

    public static func evaluate(currentLat: Double, currentLon: Double, places: [Place],
                                prevInside: Set<String>, enterRadius: Double = 150, exitRadius: Double = 200) -> Result {
        // 坏定位：绝不误判"到达/离开"，保持原状（同服务端与全库"非有限不动作"一贯原则）。
        guard currentLat.isFinite, currentLon.isFinite else {
            return Result(arrived: [], departed: [], insideLabels: prevInside)
        }
        var arrived: [String] = [], departed: [String] = [], inside: Set<String> = []
        for p in places {
            guard p.lat.isFinite, p.lng.isFinite else { continue } // 无/坏坐标跳过
            let d = Geo.distanceMeters(fromLat: currentLat, fromLon: currentLon, toLat: p.lat, toLon: p.lng)
            let wasInside = prevInside.contains(p.label)
            let nowInside = wasInside ? d <= exitRadius : d <= enterRadius // 滞回
            if nowInside {
                inside.insert(p.label)
                if !wasInside { arrived.append(p.label) } // 外→内：新到达
            } else if wasInside {
                departed.append(p.label) // 内→外：离开（越出 exitRadius 才判，与到达同一滞回门槛）
            }
        }
        return Result(arrived: arrived, departed: departed, insideLabels: inside)
    }
}
