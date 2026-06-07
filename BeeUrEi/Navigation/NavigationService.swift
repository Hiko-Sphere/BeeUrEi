import Foundation
import MapKit
import CoreLocation

/// 步行导航的 I/O 适配（海外 MapKit；真机验证）：定位、航向、目的地搜索、步行路线。
/// 决策逻辑（精度门控/转向播报/方位）在已测核心（LocationAccuracyGate/RouteProgress/Geo/BeaconDirection）。
final class NavigationService: NSObject {
    private let locationManager = CLLocationManager()

    var onLocation: ((CLLocation) -> Void)?
    var onHeading: ((CLHeading) -> Void)?

    override init() {
        super.init()
        locationManager.delegate = self
        locationManager.desiredAccuracy = kCLLocationAccuracyBest
    }

    func requestAuthAndStart() {
        locationManager.requestWhenInUseAuthorization()
        locationManager.startUpdatingLocation()
        locationManager.startUpdatingHeading()
    }

    func stop() {
        locationManager.stopUpdatingLocation()
        locationManager.stopUpdatingHeading()
    }

    /// 搜索目的地，返回首个匹配坐标。
    func geocode(_ query: String) async -> CLLocationCoordinate2D? {
        let request = MKLocalSearch.Request()
        request.naturalLanguageQuery = query
        let response = try? await MKLocalSearch(request: request).start()
        return response?.mapItems.first?.placemark.coordinate
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
}
