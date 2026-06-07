import Foundation

/// 发行地区（见 docs/PLAN.md §1.2 / §5.6）。
public enum Region: Sendable, Equatable {
    case overseas   // 海外
    case china      // 中国大陆
}

/// 导航实现提供方。
public enum RouteProvider: Sendable, Equatable {
    case mapKit             // Apple MKDirections（出发联网一次后可离线）
    case licensedChinaSDK   // 持牌图商（高德/百度，持续联网）
}

/// 按地区选择导航提供方，并给出联网口径。
public struct RouteProviderSelector: Sendable {
    public init() {}

    public func provider(for region: Region) -> RouteProvider {
        switch region {
        case .overseas: return .mapKit
        case .china:    return .licensedChinaSDK
        }
    }

    /// 是否「持续联网」。china 持牌图商持续联网；MapKit 出发取一次后可离线。
    public func requiresContinuousNetwork(for region: Region) -> Bool {
        provider(for: region) == .licensedChinaSDK
    }
}
