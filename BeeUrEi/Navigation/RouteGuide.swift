import Foundation
import MapKit

/// 导航层协议（地区抽象）。`Region` / `RouteProviderSelector` 来自已单测的核心。
protocol RouteGuiding: AnyObject {
    func startGuidance(to destination: String, region: Region)
    func stopGuidance()
}

/// 海外：MapKit 步行路线。注意：路线计算在 Apple 服务器、出发联网一次（见 PLAN §3.3）。
final class MapKitRouteGuide {
    /// 计算两点间步行路线，返回逐步指令文本。
    func walkingSteps(from: CLLocationCoordinate2D, to: CLLocationCoordinate2D) async throws -> [String] {
        let request = MKDirections.Request()
        request.transportType = .walking
        request.source = MKMapItem(placemark: MKPlacemark(coordinate: from))
        request.destination = MKMapItem(placemark: MKPlacemark(coordinate: to))

        let response = try await MKDirections(request: request).calculate()
        guard let route = response.routes.first else { return [] }
        return route.steps.map(\.instructions).filter { !$0.isEmpty }
    }
}

/// 地区抽象的导航门面：按 `RouteProviderSelector`（核心）选择实现。
final class RouteGuide: RouteGuiding {
    private let selector = RouteProviderSelector()
    private let mapKit = MapKitRouteGuide()

    func startGuidance(to destination: String, region: Region) {
        switch selector.provider(for: region) {
        case .mapKit:
            // TODO(Phase 2): geocode 目的地 → mapKit.walkingSteps → 空间音信标 + 路口播报。
            break
        case .licensedChinaSDK:
            // TODO(§13.3): 接入持牌图商（高德/百度）SDK（需 API key），含 GCJ-02 纠偏。
            break
        }
    }

    func stopGuidance() {}
}
