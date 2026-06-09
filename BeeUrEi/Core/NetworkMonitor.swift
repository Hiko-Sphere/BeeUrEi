import Foundation
import Network
import Observation

/// 网络状态监视（@MainActor @Observable 单例）。在帮助/通话界面显示当前用的是
/// WiFi / 移动数据 / 有线(开发链接) / 其它，以及是否为"按流量计费/受限"网络。
///
/// 关于"信号强弱"：iOS **不开放**读取蜂窝/WiFi 原始信号格数的公开 API（私有 API 上架会被拒）。
/// 因此通话中的"信号"用 WebRTC 实测的连接质量（往返时延/码率，见 CallViewModel）来表达，更贴合视频通话体验。
@MainActor
@Observable
final class NetworkMonitor {
    static let shared = NetworkMonitor()

    enum Kind { case wifi, cellular, wired, other, none }
    private(set) var kind: Kind = .none
    private(set) var isExpensive = false   // 蜂窝/个人热点等按量计费
    private(set) var isConstrained = false  // 低数据模式

    private let monitor = NWPathMonitor()
    private let queue = DispatchQueue(label: "com.beeurei.netmonitor")

    private init() {
        monitor.pathUpdateHandler = { [weak self] path in
            let kind: Kind = {
                guard path.status == .satisfied else { return .none }
                if path.usesInterfaceType(.wifi) { return .wifi }
                if path.usesInterfaceType(.cellular) { return .cellular }
                if path.usesInterfaceType(.wiredEthernet) { return .wired } // iPhone 经数据线接电脑共享网络时归此类
                return .other
            }()
            let expensive = path.isExpensive
            let constrained = path.isConstrained
            Task { @MainActor in
                self?.kind = kind
                self?.isExpensive = expensive
                self?.isConstrained = constrained
            }
        }
        monitor.start(queue: queue)
    }

    var label: String {
        switch kind {
        case .wifi: return "WiFi"
        case .cellular: return "移动数据"
        case .wired: return "有线链接"
        case .other: return "网络"
        case .none: return "无网络"
        }
    }

    var systemImage: String {
        switch kind {
        case .wifi: return "wifi"
        case .cellular: return "antenna.radiowaves.left.and.right"
        case .wired: return "cable.connector"
        case .other: return "network"
        case .none: return "wifi.slash"
        }
    }
}
