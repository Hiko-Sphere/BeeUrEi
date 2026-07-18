import Foundation
import CoreLocation
import MapKit
import UIKit
import AVFoundation

/// 环境感知三键（Soundscape 式）：
/// - 「我在哪」：反查地址 + 附近地点；
/// - 「周围有什么」：按**时钟方位**播报四周地点（"三点钟方向约50米，全家便利店"）；
/// - 「前方有什么」：只报朝向 ±50° 扇区内的地点。
/// 不导航也能建立心理地图。端侧 CLGeocoder/MKLocalSearch，无需后端。
final class LocationDescriber: NSObject, CLLocationManagerDelegate {
    enum Mode { case whereAmI, around, ahead, facing, nearest } // nearest 的类别另存 nearestQuery（保 Mode 简单可 == 比较）

    private let manager = CLLocationManager()
    private let geocoder = CLGeocoder()
    private var isDescribing = false // 防重入：上一次还在解析时忽略新点击（见审查 #3）
    private var hasFix = false // 本轮是否已拿到定位点（看门狗据此区分"定位没来"与"定位来了但 POI 检索慢"，复审并发#2）
    private var mode: Mode = .whereAmI
    private var nearestQuery = "" // 「最近的X」的类别（.nearest 模式用）
    private var lastHeading: Double? // 最近真北航向（罗盘），供相对方位计算
    private var watchdog: DispatchWorkItem? // 看门狗：定位/解析无回调时复位，避免永久卡死
    private var lang: Language = FeatureSettings().language // 播报语言（E5，每次触发时解析）

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyNearestTenMeters
    }

    func describe() { run(.whereAmI) }
    func describeAround() { run(.around) }
    func describeAhead() { run(.ahead) }
    func describeFacing() { run(.facing) }
    /// 「最近的X」：就近查找某类公共地点，报最近一家的店名 + 时钟方位 + 距离。
    func findNearest(_ query: String) {
        // 与 run 同一门禁提前到写 nearestQuery **之前**：否则在途请求未完时，被 run 拒掉的第二次请求
        // 已经把 nearestQuery 覆盖了，第一次请求的定位回调会据此播报错误的类别（复审并发#1）。
        guard !isDescribing else { return }
        nearestQuery = query.trimmingCharacters(in: .whitespacesAndNewlines)
        run(.nearest)
    }

    private func promptFor(_ m: Mode) -> String {
        switch m {
        case .whereAmI: return lang == .zh ? "正在确定你的位置" : "Finding your location"
        case .around: return lang == .zh ? "正在查看周围有什么" : "Checking what's around you"
        case .ahead: return lang == .zh ? "正在查看前方有什么" : "Checking what's ahead"
        case .facing: return lang == .zh ? "正在确定你的朝向" : "Checking which way you're facing"
        case .nearest: return lang == .zh ? "正在查找最近的\(nearestQuery)" : "Finding the nearest \(nearestQuery)"
        }
    }

    private func run(_ m: Mode) {
        guard !isDescribing else { return }
        lang = FeatureSettings().language
        mode = m
        isDescribing = true
        hasFix = false // 本轮尚未拿到定位点（用于看门狗区分"定位没来"与"定位来了但 POI 检索慢"）
        speak(promptFor(m))
        // 看门狗：20s 无结果就复位（含网络 POI 检索），避免 requestLocation 无回调导致永久卡死后再点无反应。
        let work = DispatchWorkItem { [weak self] in
            guard let self, self.isDescribing else { return }
            // 三种超时根因给不同指引：①朝向不可信→校准；②定位已拿到但 POI 检索慢→查询超时（**不**误导去查定位权限）；
            // ③定位始终没来→定位超时，查权限/信号（复审并发#2：此前一律报"定位超时"，POI 后端慢时误导用户）。
            let msg: String
            if self.mode == .facing {
                msg = self.lang == .zh ? "暂时无法确定朝向，请把手机平举、水平画几个 8 字校准罗盘后再试"
                                       : "Can't determine your heading yet — hold the phone flat and wave it in a figure-8 to calibrate, then retry"
            } else if self.hasFix {
                msg = self.lang == .zh ? "查询超时，请稍后再试" : "The lookup timed out — please try again"
            } else {
                msg = self.lang == .zh ? "定位超时，请检查定位权限与信号后重试"
                                       : "Locating timed out — check location permission and signal, then retry"
            }
            self.finish(msg)
        }
        watchdog = work
        DispatchQueue.main.asyncAfter(deadline: .now() + 20, execute: work)
        manager.startUpdatingHeading() // 周围/前方需要朝向；我在哪不依赖（拿到也无妨）
        // 按授权状态分支：未决时先请求授权，授权后在 didChangeAuthorization 里再定位
        // （.notDetermined 时直接 requestLocation 会与授权弹窗竞争而常常无回调）。
        switch manager.authorizationStatus {
        case .authorizedWhenInUse, .authorizedAlways:
            manager.requestLocation()
        case .notDetermined:
            manager.requestWhenInUseAuthorization()
        case .denied, .restricted:
            finish(lang == .zh ? "定位权限未开启，请在系统设置中允许定位" : "Location is off. Allow location in Settings.")
        @unknown default:
            manager.requestWhenInUseAuthorization()
        }
    }

    func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        guard isDescribing else { return }
        switch manager.authorizationStatus {
        case .authorizedWhenInUse, .authorizedAlways:
            manager.requestLocation()
        case .denied, .restricted:
            finish(lang == .zh ? "定位权限未开启，请在系统设置中允许定位" : "Location is off. Allow location in Settings.")
        default:
            break // .notDetermined：等用户在系统弹窗里决定
        }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateHeading newHeading: CLHeading) {
        guard newHeading.headingAccuracy >= 0 else { return } // 罗盘不可信不更新
        let h = newHeading.trueHeading >= 0 ? newHeading.trueHeading : newHeading.magneticHeading
        lastHeading = h
        // 「我朝哪个方向」：拿到第一个可信罗盘读数即播报八方位并复位（finish 停罗盘，后续读数不再重复播）。
        // 非有限读数 CompassRose 返回 nil → 不 finish，继续等下一个可信读数（不会播"方向未知"这种废话）。
        if mode == .facing, isDescribing, let cardinal = CompassRose.cardinal(degrees: h, language: lang) {
            finish(lang == .zh ? "你正面朝\(cardinal)" : "You're facing \(cardinal)")
        }
    }

    func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        guard let loc = locations.last else { return }
        hasFix = true // 定位点已到：此后若超时是 POI 检索慢（查询超时），非定位问题（复审并发#2）
        switch mode {
        case .whereAmI:
            // 境内改用高德 regeo（准确街道门牌 + 最近地标绝对方位——盲人可精确转述给出租车/家人）；
            // 境外/高德失败回退 Apple CLGeocoder。与「周围有什么/最近的X」同一数据源分流原则。
            if ChinaCoord.isInChina(lat: loc.coordinate.latitude, lon: loc.coordinate.longitude) {
                amapWhereAmI(loc)
            } else {
                appleWhereAmI(loc)
            }
        case .around, .ahead:
            poiCallouts(loc)
        case .nearest:
            nearestCallouts(loc, query: nearestQuery)
        case .facing:
            break // 朝向只依赖罗盘（didUpdateHeading 里播报并复位），不需要定位点
        }
    }

    /// 「我在哪」国内高德逆地理：准确街道门牌 + 最近地标绝对方位，经 core WhereAmIComposer 组织播报。
    private func amapWhereAmI(_ loc: CLLocation) {
        let g = ChinaCoord.wgs84ToGcj02(lat: loc.coordinate.latitude, lon: loc.coordinate.longitude)
        let lang = self.lang
        Task { [weak self] in
            guard let self else { return }
            do {
                let result = try await AMapReverseGeocodeClient().whereAmI(latGcj: g.lat, lonGcj: g.lon)
                let text = WhereAmIComposer.compose(result, language: lang, unit: FeatureSettings().distanceUnit)
                await MainActor.run { self.finish(text) }
            } catch {
                // 高德失败（未配 key/查不到/网络）回退 Apple——但若看门狗已超时复位则不再做无用逆编码（复审并发#2）。
                await MainActor.run { if self.isDescribing { self.appleWhereAmI(loc) } }
            }
        }
    }

    /// 「我在哪」海外/兜底路径：Apple CLGeocoder 逆地理 + MapKit 附近 POI。
    private func appleWhereAmI(_ loc: CLLocation) {
        geocoder.reverseGeocodeLocation(loc, preferredLocale: Locale(identifier: lang.localeIdentifier)) { [weak self] placemarks, _ in
            guard let self else { return }
            let address = Self.addressString(placemarks?.first, self.lang)
            self.findNearby(loc) { nearby in
                let near = self.lang == .zh ? "。附近有：" : ". Nearby: "
                let text = nearby.isEmpty ? address : address + near + nearby
                self.finish(text)
            }
        }
    }

    /// 就近找某类地点：国内高德定向检索、海外 MapKit 自然语言检索；统一走 core 的 nearest 播报。
    private func nearestCallouts(_ loc: CLLocation, query: String) {
        let radius = 1000 // 找特定地点比"周围有什么"(250m)放宽到 1km——值得为一个厕所/药店走远些
        if ChinaCoord.isInChina(lat: loc.coordinate.latitude, lon: loc.coordinate.longitude) {
            amapNearest(loc, query: query, radius: radius)
        } else {
            mapKitNearest(loc, query: query, radius: radius)
        }
    }

    private func amapNearest(_ loc: CLLocation, query: String, radius: Int) {
        let g = ChinaCoord.wgs84ToGcj02(lat: loc.coordinate.latitude, lon: loc.coordinate.longitude)
        let heading = lastHeading
        let lang = self.lang
        Task { [weak self] in
            guard let self else { return }
            do {
                let resp = try await AMapAroundClient().around(latGcj: g.lat, lonGcj: g.lon, radiusMeters: radius, keywords: query)
                let obs = resp.pois.map { p in
                    PoiObservation(name: p.name, distanceMeters: p.distanceMeters,
                                   relativeBearingDegrees: self.relativeBearing(fromLat: g.lat, fromLon: g.lon,
                                                                                toLat: p.lat, toLon: p.lon, heading: heading))
                }
                let text = PoiCalloutComposer.nearest(from: obs, query: query, radiusMeters: resp.radius, language: lang, unit: FeatureSettings().distanceUnit)
                // 存下被朗读的**那一处**最近地点（同一 nearestIndex 选择，obs 与 resp.pois 同序），供语音"带我去那里"精确导航过去。
                // amap POI 是 GCJ-02 → 转 WGS-84 存（导航层按 WGS-84 消费，内部再转 GCJ）。无有效地点则清空（不留陈旧）。
                let found: (name: String, lat: Double, lon: Double)? = PoiCalloutComposer.nearestIndex(from: obs).map { idx in
                    let p = resp.pois[idx]
                    let w = ChinaCoord.gcj02ToWgs84(lat: p.lat, lon: p.lon)
                    return (name: p.name, lat: w.lat, lon: w.lon)
                }
                await MainActor.run { AppRoute.shared.lastFoundNearest = found; self.finish(text) }
            } catch {
                // 高德失败回退 MapKit——但若看门狗已超时复位则不再做无用检索（复审并发#2）。
                await MainActor.run { if self.isDescribing { self.mapKitNearest(loc, query: query, radius: radius) } }
            }
        }
    }

    private func mapKitNearest(_ loc: CLLocation, query: String, radius: Int) {
        let request = MKLocalSearch.Request()
        request.naturalLanguageQuery = query
        request.region = MKCoordinateRegion(center: loc.coordinate,
                                            latitudinalMeters: CLLocationDistance(radius * 2),
                                            longitudinalMeters: CLLocationDistance(radius * 2))
        MKLocalSearch(request: request).start { [weak self] response, _ in
            guard let self else { return }
            let heading = self.lastHeading
            // 保留 obs 与坐标**并行**（compactMap 会丢无名/无坐标项，索引须一致才能据 nearestIndex 取回被朗读那处的坐标）。
            let items: [(obs: PoiObservation, coord: CLLocationCoordinate2D)] = (response?.mapItems ?? []).prefix(15).compactMap { item in
                guard let name = item.name, let ploc = item.placemark.location else { return nil }
                let o = PoiObservation(
                    name: name,
                    distanceMeters: loc.distance(from: ploc),
                    relativeBearingDegrees: self.relativeBearing(fromLat: loc.coordinate.latitude, fromLon: loc.coordinate.longitude,
                                                                 toLat: ploc.coordinate.latitude, toLon: ploc.coordinate.longitude, heading: heading))
                return (o, ploc.coordinate)
            }
            let obs = items.map(\.obs)
            let text = PoiCalloutComposer.nearest(from: obs, query: query, radiusMeters: radius, language: self.lang, unit: FeatureSettings().distanceUnit)
            // 存下被朗读的那一处（海外 MapKit 坐标已是 WGS-84，直存），供"带我去那里"精确导航；无有效地点则清空。
            AppRoute.shared.lastFoundNearest = PoiCalloutComposer.nearestIndex(from: obs).map { idx in
                (name: obs[idx].name, lat: items[idx].coord.latitude, lon: items[idx].coord.longitude)
            }
            self.finish(text)
        }
    }

    /// 周围/前方：POI 按时钟方位 + 距离播报。国内改用高德 POI（Apple Maps 境内覆盖稀疏），海外用 MapKit。
    /// 组织播报统一走 core `PoiCalloutComposer`（已单测），两条数据源行为一致。
    private func poiCallouts(_ loc: CLLocation) {
        let radius = mode == .ahead ? 400 : 250
        // 境内用高德（数据密集且中文准确）；境外用 MapKit。isInChina 用真实经纬度判定（近海边界少量误判无害，会自动回退）。
        if ChinaCoord.isInChina(lat: loc.coordinate.latitude, lon: loc.coordinate.longitude) {
            amapPoiCallouts(loc, radius: radius)
        } else {
            mapKitPoiCallouts(loc, radius: radius)
        }
    }

    private var composerMode: PoiCalloutMode { mode == .ahead ? .ahead : .around }

    /// 相对朝向方位角（度，(-180,180]），罗盘不可用返回 nil。from/to 必须同坐标系。
    private func relativeBearing(fromLat: Double, fromLon: Double, toLat: Double, toLon: Double, heading: Double?) -> Double? {
        guard let heading else { return nil }
        let bearing = Geo.initialBearing(fromLat: fromLat, fromLon: fromLon, toLat: toLat, toLon: toLon)
        var rel = (bearing - heading).truncatingRemainder(dividingBy: 360)
        if rel > 180 { rel -= 360 } else if rel < -180 { rel += 360 }
        return rel
    }

    /// 高德周边 POI（国内）：用户位置 WGS-84→GCJ-02（与步行导航同约定），使方位角与高德 POI（GCJ-02）同系。
    /// 距离直接用高德算好的值（权威，勿再客户端算免混坐标系）。任何失败回退 Apple Maps POI，功能不因国内源失效而全哑。
    private func amapPoiCallouts(_ loc: CLLocation, radius: Int) {
        let g = ChinaCoord.wgs84ToGcj02(lat: loc.coordinate.latitude, lon: loc.coordinate.longitude)
        let heading = lastHeading
        let mode = composerMode
        let lang = self.lang
        Task { [weak self] in
            guard let self else { return }
            do {
                let resp = try await AMapAroundClient().around(latGcj: g.lat, lonGcj: g.lon, radiusMeters: radius)
                let obs = resp.pois.map { p in
                    PoiObservation(name: p.name, distanceMeters: p.distanceMeters,
                                   relativeBearingDegrees: self.relativeBearing(fromLat: g.lat, fromLon: g.lon,
                                                                                toLat: p.lat, toLon: p.lon, heading: heading),
                                   category: p.category) // 类别（"快餐厅"等）随 POI 一起喂给 composer，识别品牌店类型
                }
                let text = PoiCalloutComposer.compose(pois: obs, mode: mode, radiusMeters: resp.radius,
                                                      headingAvailable: heading != nil, language: lang,
                                                      unit: FeatureSettings().distanceUnit)
                await MainActor.run { self.finish(text) }
            } catch {
                // 高德不可用 → 回退 MapKit；但看门狗已超时复位则不再做无用检索（复审并发#2）。
                await MainActor.run { if self.isDescribing { self.mapKitPoiCallouts(loc, radius: radius) } }
            }
        }
    }

    /// MapKit POI 类别 → 简短本地化类别名（境外「周围有什么」用，补齐与境内高德 category 的 parity）。
    /// 境内高德 POI 会随播类型（"肯德基，快餐厅"），境外 MapKit 路径此前把 pointOfInterestCategory 丢弃——
    /// ZH 盲人在国外只听到陌生店名（"Boots""Tesco"），不知是药店/超市。补上让他一听即知这是什么地方。
    /// 只映射**对出行有用、含义明确**的常见类别（吃/医/钱/交通/如厕/住宿/店铺等）；未知/未映射 → nil
    /// （composer 自然不追加、回退原行为，绝不硬凑）。composer 仅在中文模式追加类别（英文嗓念中文类别会乱），
    /// 但这里如实按语言给名，交由 composer 决定是否追加（保持职责单一、便于单测）。
    static func poiCategoryName(_ cat: MKPointOfInterestCategory?, _ lang: Language) -> String? {
        guard let cat else { return nil }
        let zh = lang == .zh
        switch cat {
        case .restaurant: return zh ? "餐厅" : "restaurant"
        case .cafe: return zh ? "咖啡馆" : "café"
        case .bakery: return zh ? "面包店" : "bakery"
        case .foodMarket: return zh ? "超市" : "market"
        case .pharmacy: return zh ? "药店" : "pharmacy"
        case .hospital: return zh ? "医院" : "hospital"
        case .bank: return zh ? "银行" : "bank"
        case .atm: return zh ? "取款机" : "ATM"
        case .gasStation: return zh ? "加油站" : "gas station"
        case .evCharger: return zh ? "充电站" : "EV charger"
        case .parking: return zh ? "停车场" : "parking"
        case .publicTransport: return zh ? "公交站" : "transit stop"
        case .restroom: return zh ? "卫生间" : "restroom"
        case .hotel: return zh ? "酒店" : "hotel"
        case .store: return zh ? "商店" : "store"
        case .park: return zh ? "公园" : "park"
        case .library: return zh ? "图书馆" : "library"
        case .school: return zh ? "学校" : "school"
        case .university: return zh ? "大学" : "university"
        case .postOffice: return zh ? "邮局" : "post office"
        case .police: return zh ? "警察局" : "police"
        case .fireStation: return zh ? "消防站" : "fire station"
        case .museum: return zh ? "博物馆" : "museum"
        case .fitnessCenter: return zh ? "健身房" : "gym"
        case .laundry: return zh ? "洗衣店" : "laundry"
        default: return nil // 未映射类别：不硬凑，回退无类别行为
        }
    }

    /// Apple Maps 周边 POI（境外，或国内高德失败回退）。
    private func mapKitPoiCallouts(_ loc: CLLocation, radius: Int) {
        let request = MKLocalPointsOfInterestRequest(center: loc.coordinate, radius: CLLocationDistance(radius))
        MKLocalSearch(request: request).start { [weak self] response, _ in
            guard let self else { return }
            let heading = self.lastHeading
            let obs: [PoiObservation] = (response?.mapItems ?? []).prefix(15).compactMap { item in
                guard let name = item.name, let ploc = item.placemark.location else { return nil }
                return PoiObservation(
                    name: name,
                    distanceMeters: loc.distance(from: ploc),
                    relativeBearingDegrees: self.relativeBearing(fromLat: loc.coordinate.latitude, fromLon: loc.coordinate.longitude,
                                                                 toLat: ploc.coordinate.latitude, toLon: ploc.coordinate.longitude, heading: heading),
                    category: Self.poiCategoryName(item.pointOfInterestCategory, self.lang)) // 类别随 POI 喂给 composer，境外也报"药店/超市"等类型（与境内高德 parity）
            }
            let text = PoiCalloutComposer.compose(pois: obs, mode: self.composerMode, radiusMeters: radius,
                                                  headingAvailable: heading != nil, language: self.lang,
                                                  unit: FeatureSettings().distanceUnit)
            self.finish(text)
        }
    }

    /// 播报结果并复位（停罗盘省电）。
    private func finish(_ text: String) {
        guard isDescribing else { return } // 已复位（如看门狗已触发）则不重复播报
        watchdog?.cancel(); watchdog = nil
        speak(text)
        manager.stopUpdatingHeading()
        isDescribing = false
    }

    private static func addressString(_ p: CLPlacemark?, _ lang: Language) -> String {
        let parts = [p?.locality, p?.subLocality, p?.thoroughfare, p?.subThoroughfare, p?.name].compactMap { $0 }
        var seen = Set<String>()
        let unique = parts.filter { seen.insert($0).inserted }
        if unique.isEmpty { return lang == .zh ? "无法确定当前位置" : "Can't determine your location" }
        let sep = lang == .zh ? "，" : ", "
        return (lang == .zh ? "你大概在：" : "You're near: ") + unique.joined(separator: sep)
    }

    private func findNearby(_ loc: CLLocation, completion: @escaping (String) -> Void) {
        let request = MKLocalPointsOfInterestRequest(center: loc.coordinate, radius: 250)
        let zh = lang == .zh
        MKLocalSearch(request: request).start { response, _ in
            let descriptions = (response?.mapItems ?? []).prefix(3).compactMap { item -> String? in
                guard let name = item.name, let placeLoc = item.placemark.location else { return nil }
                let m = Int(loc.distance(from: placeLoc).rounded())
                return zh ? "\(name) 约\(m)米" : "\(name) about \(m) m"
            }
            completion(descriptions.joined(separator: zh ? "，" : ", "))
        }
    }

    func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        finish(lang == .zh ? "定位失败，请检查定位权限与信号" : "Locating failed — check location permission and signal")
    }

    /// 经全局语音总线 .query 通道：避障/导航播报期间不再同时出声（积压待其说完补播）。嗓音随 App 语言。
    private func speak(_ text: String) {
        SpeechHub.shared.speak(text, channel: .query, voiceCode: lang.voiceCode)
    }
}
