import SwiftUI
import CoreLocation
import MapKit
import UIKit

// MARK: - 位置消息载荷（编码进 ChatMessage.text，kind = "location"）

/// 形如 {"lat":31.23,"lng":121.47,"name":"上海市黄浦区南京东路"}。
/// name 为反查到的地址（best-effort，可空）。坐标超范围视为非法。
struct LocationPayload: Codable, Equatable {
    let lat: Double
    let lng: Double
    var name: String?

    var coordinate: CLLocationCoordinate2D { .init(latitude: lat, longitude: lng) }

    /// 解析消息文本；非法返回 nil（旧客户端会把它当普通文本显示，不会崩）。
    static func decode(_ text: String) -> LocationPayload? {
        guard let data = text.data(using: .utf8),
              let p = try? JSONDecoder().decode(LocationPayload.self, from: data),
              p.lat >= -90, p.lat <= 90, p.lng >= -180, p.lng <= 180 else { return nil }
        return p
    }

    /// 编码为紧凑 JSON 字符串。
    func encoded() -> String {
        guard let data = try? JSONEncoder().encode(self),
              let s = String(data: data, encoding: .utf8) else {
            return "{\"lat\":\(lat),\"lng\":\(lng)}"
        }
        return s
    }

    /// 用 Apple 地图打开并以步行模式导航过去（盲人用户最常见诉求）。
    func openInMaps() {
        let item = MKMapItem(placemark: MKPlacemark(coordinate: coordinate))
        item.name = name
        item.openInMaps(launchOptions: [MKLaunchOptionsDirectionsModeKey: MKLaunchOptionsDirectionsModeWalking])
    }
}

// MARK: - 一次性取精确位置 + 反查地址（仅用户主动点"发送位置"时调用）

/// 健壮性同 CoarseLocality：① 总超时兜底（弱网/无回调不挂起）；② 未决授权先请求授权，授权后再定位；
/// ③ finish 只 resume 一次。精度 NearestTenMeters（共享位置需较准，但无需导航级最高精度，省电）。
final class LocationShareFetcher: NSObject, CLLocationManagerDelegate {
    private let manager = CLLocationManager()
    private let geocoder = CLGeocoder()
    private var cont: CheckedContinuation<LocationPayload?, Never>?

    func fetch(timeout: TimeInterval = 8) async -> LocationPayload? {
        let status = manager.authorizationStatus
        guard status != .denied, status != .restricted else { return nil }
        return await withCheckedContinuation { c in
            cont = c
            manager.delegate = self
            manager.desiredAccuracy = kCLLocationAccuracyNearestTenMeters
            DispatchQueue.main.asyncAfter(deadline: .now() + timeout) { [weak self] in self?.finish(nil) }
            if status == .notDetermined {
                manager.requestWhenInUseAuthorization() // 结果在 didChangeAuthorization 里再发起定位
            } else {
                manager.requestLocation()
            }
        }
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        switch manager.authorizationStatus {
        case .authorizedWhenInUse, .authorizedAlways: manager.requestLocation()
        case .denied, .restricted: finish(nil)
        default: break // .notDetermined：等待系统弹窗
        }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let loc = locations.last else { finish(nil); return }
        let lat = loc.coordinate.latitude, lng = loc.coordinate.longitude
        let locale = FeatureSettings().language == .zh ? Locale(identifier: "zh_CN") : Locale.current
        geocoder.reverseGeocodeLocation(loc, preferredLocale: locale) { [weak self] placemarks, _ in
            let name = Self.addressLine(placemarks?.first)
            self?.finish(LocationPayload(lat: lat, lng: lng, name: name))
        }
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) { finish(nil) }

    /// 仅 resume 一次：超时/拒绝/失败/反查完成，谁先到谁 resume，其余 no-op。
    private func finish(_ p: LocationPayload?) {
        guard let c = cont else { return }
        cont = nil
        c.resume(returning: p)
    }

    /// 拼一行可读地址（街道/子区/市/省，去重）。无可用字段返回 nil。
    private static func addressLine(_ p: CLPlacemark?) -> String? {
        guard let p else { return nil }
        let parts = [p.name, p.subLocality, p.locality, p.administrativeArea].compactMap { $0 }
        var seen = Set<String>()
        let unique = parts.filter { seen.insert($0).inserted }
        let line = unique.joined(separator: " ")
        return line.isEmpty ? nil : line
    }
}

// MARK: - 位置气泡（地图缩略图 + 地址，点按用地图打开导航；VoiceOver 读地址）

struct LocationBubble: View {
    let payload: LocationPayload
    let lang: Language
    @State private var snapshot: UIImage?

    private var place: String { payload.name ?? ChatStrings.unknownPlace(lang) }

    var body: some View {
        Button { payload.openInMaps() } label: {
            VStack(alignment: .leading, spacing: 0) {
                ZStack {
                    if let snapshot {
                        Image(uiImage: snapshot).resizable().scaledToFill()
                    } else {
                        Rectangle().fill(Color(.tertiarySystemBackground))
                            .overlay(ProgressView())
                    }
                    Image(systemName: "mappin.circle.fill")
                        .font(.system(size: 30)).foregroundStyle(.red)
                        .shadow(radius: 2)
                }
                .frame(width: 220, height: 130)
                .clipped()
                HStack(spacing: 6) {
                    Image(systemName: "location.fill").font(.caption)
                    Text(place).font(.subheadline.weight(.medium)).lineLimit(2)
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 10).padding(.vertical, 8)
            }
            .frame(width: 220)
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
        .buttonStyle(.plain)
        .task(id: "\(payload.lat),\(payload.lng)") {
            snapshot = await Self.makeSnapshot(for: payload.coordinate,
                                               size: CGSize(width: 220, height: 130))
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(ChatStrings.locationA11y(place, lang))
        .accessibilityAddTraits(.isButton)
    }

    /// 用 MKMapSnapshotter 生成一张静态地图缩略图（失败回退到占位底色）。
    static func makeSnapshot(for coord: CLLocationCoordinate2D, size: CGSize) async -> UIImage? {
        let options = MKMapSnapshotter.Options()
        options.region = MKCoordinateRegion(center: coord, latitudinalMeters: 400, longitudinalMeters: 400)
        options.size = size
        options.showsBuildings = true
        let snapshotter = MKMapSnapshotter(options: options)
        return await withCheckedContinuation { cont in
            snapshotter.start { snap, _ in cont.resume(returning: snap?.image) }
        }
    }
}
