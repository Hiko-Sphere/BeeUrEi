import Foundation
import MapKit
import CoreLocation

/// 导航定位/路线服务抽象（F1）：供 NavigationViewModel 注入 mock 单测——
/// 记路精度门控与回程到达门控是安全攸关胶水逻辑（误报到达/坏精度入轨都是历史审查项）。
protocol NavigationServicing: AnyObject {
    var onLocation: ((CLLocation) -> Void)? { get set }
    var onHeading: ((CLHeading) -> Void)? { get set }
    /// 定位权限被拒/受限（首次拒绝或本就拒绝）——上层据此朗读"请开启定位"并停下，避免永久卡在"正在定位…"（见 P0 审计）。
    var onAuthDenied: (() -> Void)? { get set }
    func requestAuthAndStart()
    func stop()
    func geocode(_ query: String) async -> CLLocationCoordinate2D?
    func walkingManeuvers(from: CLLocationCoordinate2D, to: CLLocationCoordinate2D) async -> [(coordinate: CLLocationCoordinate2D, instruction: String)]
}

/// 步行导航的 I/O 适配（海外 MapKit；真机验证）：定位、航向、目的地搜索、步行路线。
/// 决策逻辑（精度门控/转向播报/方位）在已测核心（LocationAccuracyGate/RouteProgress/Geo/BeaconDirection）。
final class NavigationService: NSObject, NavigationServicing {
    private let locationManager = CLLocationManager()

    var onLocation: ((CLLocation) -> Void)?
    var onHeading: ((CLHeading) -> Void)?
    var onAuthDenied: (() -> Void)?

    override init() {
        super.init()
        locationManager.delegate = self
        locationManager.desiredAccuracy = kCLLocationAccuracyBest
    }

    func requestAuthAndStart() {
        // 按当前授权态分支：未决→请求（结果在 didChangeAuthorization 处理）；已拒/受限→立即回报；已授权→开始。
        // 不在未决时就无条件 start——否则被拒时没有任何回调，上层永远停在"正在定位…"（见 P0 审计；参考 WeatherSpeaker）。
        switch locationManager.authorizationStatus {
        case .notDetermined:
            locationManager.requestWhenInUseAuthorization()
        case .denied, .restricted:
            onAuthDenied?()
        default:
            startUpdates()
        }
    }

    private func startUpdates() {
        locationManager.startUpdatingLocation()
        locationManager.startUpdatingHeading()
    }

    func stop() {
        locationManager.stopUpdatingLocation()
        locationManager.stopUpdatingHeading()
    }

    /// 坐标有效性：排除 NaN/越界与 Null Island(0,0)——后两者多为解析失败的"伪坐标"，会把人导向几内亚湾（见审查/审计）。
    static func isValidDestination(_ c: CLLocationCoordinate2D) -> Bool {
        CLLocationCoordinate2DIsValid(c)
            && c.latitude.magnitude <= 90 && c.longitude.magnitude <= 180
            && !(c.latitude.magnitude < 1e-7 && c.longitude.magnitude < 1e-7)
    }

    /// 搜索目的地，返回首个匹配坐标（无效坐标视为未找到）。
    func geocode(_ query: String) async -> CLLocationCoordinate2D? {
        let request = MKLocalSearch.Request()
        request.naturalLanguageQuery = query
        let response = try? await MKLocalSearch(request: request).start()
        guard let coord = response?.mapItems.first?.placemark.coordinate,
              Self.isValidDestination(coord) else { return nil }
        return coord
    }

    /// 步行路线：返回各「转向点（坐标 + 指令文本）」，跳过出发步。
    func walkingManeuvers(from: CLLocationCoordinate2D, to: CLLocationCoordinate2D) async -> [(coordinate: CLLocationCoordinate2D, instruction: String)] {
        let request = MKDirections.Request()
        request.transportType = .walking
        request.source = MKMapItem(placemark: MKPlacemark(coordinate: from))
        request.destination = MKMapItem(placemark: MKPlacemark(coordinate: to))
        guard let route = try? await MKDirections(request: request).calculate(), let first = route.routes.first else {
            return []
        }
        return first.steps.compactMap { step in
            let text = step.instructions
            guard !text.isEmpty, step.polyline.pointCount > 0 else { return nil }
            let coord = step.polyline.points()[0].coordinate
            guard Self.isValidDestination(coord) else { return nil } // 跳过无效转向点坐标
            return (coord, text)
        }
    }
}

extension NavigationService: CLLocationManagerDelegate {
    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        if let loc = locations.last { onLocation?(loc) }
    }
    func locationManager(_ manager: CLLocationManager, didUpdateHeading newHeading: CLHeading) {
        onHeading?(newHeading)
    }
    /// 权限变化：授权→开始；拒绝/受限→回报上层（避免永久"正在定位…"，见 P0 审计）。
    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        switch manager.authorizationStatus {
        case .authorizedWhenInUse, .authorizedAlways: startUpdates()
        case .denied, .restricted: onAuthDenied?()
        default: break // .notDetermined：等待用户在系统弹窗里决定
        }
    }
}
