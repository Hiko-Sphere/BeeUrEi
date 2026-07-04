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

    /// 向后兼容的「文本消息」形式：内嵌一个 Apple 地图链接（坐标 + 地名）。
    /// 这样无需服务端支持 kind="location"（线上服务器未重新部署时仍可发送）：
    /// 新客户端解析此链接渲染为地图气泡；旧客户端/收件人看到的是可点的地图链接（优雅降级）。
    func asText() -> String {
        let coord = String(format: "%.6f,%.6f", lat, lng)
        var url = "https://maps.apple.com/?ll=\(coord)"
        if let name, !name.isEmpty {
            // 用 .alphanumerics 全量百分号编码，确保 q 值不含空格/&/= 等会破坏解析的字符（中文按字节编码，可逆）。
            let enc = name.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? ""
            url += "&q=\(enc)"
            return "📍 \(name)\n\(url)" // 前缀地名仅供旧客户端/推送预览阅读；新客户端只渲染气泡
        }
        return "📍\n\(url)"
    }

    /// 从一条聊天消息识别位置：kind="location"（JSON）或 kind="text"（内嵌 Apple 地图链接）。
    static func from(_ m: ChatMessageInfo) -> LocationPayload? {
        if m.kind == "location" { return decode(m.text) }
        if m.kind == "text" { return fromText(m.text) }
        return nil
    }

    /// 从文本里抽取 Apple 地图链接并解析为坐标 + 地名；无链接或越界返回 nil。
    static func fromText(_ text: String) -> LocationPayload? {
        guard let r = text.range(of: "https://maps.apple.com/?ll=") else { return nil }
        let urlStr = String(text[r.lowerBound...].prefix { !$0.isWhitespace }) // 取到首个空白/换行为止
        guard let comps = URLComponents(string: urlStr),
              let ll = comps.queryItems?.first(where: { $0.name == "ll" })?.value else { return nil }
        let parts = ll.split(separator: ",")
        guard parts.count == 2, let lat = Double(parts[0]), let lng = Double(parts[1]),
              lat >= -90, lat <= 90, lng >= -180, lng <= 180 else { return nil }
        let q = comps.queryItems?.first(where: { $0.name == "q" })?.value
        let name = q.flatMap { $0.removingPercentEncoding ?? $0 } // URLComponents 多已解码，再兜底一次
        return LocationPayload(lat: lat, lng: lng, name: (name?.isEmpty == false) ? name : nil)
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
    var mine: Bool = false          // 自己发的位置无需"导航去这里"（导航到自己脚下无意义）
    @State private var snapshot: UIImage?
    @State private var showNav = false

    private var place: String { payload.name ?? ChatStrings.unknownPlace(lang) }

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            mapCard
            // 收到亲友的位置（"我在这儿等你"）→ 直接用**蜂之眼盲人优化导航**过去（信标/钟点方位/避障联动），
            // 而非只能跳 Apple 地图的通用引导。经既有 pendingNavAction=.search(地址) 种子——与语音"带我去X"
            // 同一条已验证路径；地址为空（发送端反查失败，罕见）时不提供（无可搜之名），地图卡仍走 Apple 地图。
            if !mine, let name = payload.name, !name.isEmpty {
                Button {
                    AppRoute.shared.pendingNavAction = .search(name)
                    showNav = true
                } label: {
                    Label(NavStrings.navigateHereFromChat(lang), systemImage: "figure.walk.circle.fill")
                        .font(.subheadline.weight(.semibold))
                }
                .buttonStyle(.borderedProminent)
                .tint(.beeHoney)
                .foregroundStyle(Color.beeInk)
            }
        }
        // 在聊天自身语境上盖全屏导航（sheet 之上盖 fullScreenCover 合法）：不做跨 sheet 关此开彼的编排。
        .fullScreenCover(isPresented: $showNav) { WalkNavigationView { showNav = false } }
    }

    private var mapCard: some View {
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
