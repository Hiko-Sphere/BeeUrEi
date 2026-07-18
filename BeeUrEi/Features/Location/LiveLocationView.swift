import SwiftUI
import MapKit
import CoreLocation

/// 实时位置共享界面：开关共享自身位置 + 地图与列表查看正在共享的联系人。
/// 盲人侧重列表 + 语音（距离/方位可读）；明眼侧（亲友/协助者）重地图。功能关闭时显示说明。
struct LiveLocationView: View {
    let isBlind: Bool
    @Environment(AuthSession.self) private var session
    @State private var manager = LiveLocationManager.shared
    @State private var camera: MapCameraPosition = .automatic
    @State private var addresses: [String: (text: String, at: Double)] = [:] // userId → (可读所在地址, 逆地理时对应的 updatedAt)：对方移动后旧地址视为过时、重查，绝不复述旧位置
    @State private var addressLoadingIds: Set<String> = []  // 正在查询的 userId（防同一联系人并发重复请求）
    private var lang: Language { FeatureSettings().language }
    private var unit: DistanceUnit { FeatureSettings().distanceUnit } // 距离单位（公制/英制，随设置）

    var body: some View {
        Group {
            if !session.features.locationSharing {
                BeeEmptyState(systemImage: "location.slash.fill",
                              title: LiveLocationStrings.featureOffTitle(lang),
                              message: LiveLocationStrings.featureOffMessage(lang))
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: BeeSpacing.md) {
                        Text(LiveLocationStrings.subtitle(lang))
                            .font(.footnote).foregroundStyle(.secondary)
                        shareCard
                        if !isBlind { mapView } // 盲人侧地图无意义，省去；明眼亲友/协助者看地图
                        contactsSection
                    }
                    .padding()
                }
            }
        }
        .navigationTitle(LiveLocationStrings.navTitle(lang))
        .navigationBarTitleDisplayMode(.inline)
        .task {
            ScreenWake.acquire("location")   // 实时位置共享查看期间屏不灭
            if let token = session.token { manager.startViewing(token: token, isBlind: isBlind) }
        }
        .onDisappear { manager.stopViewing(); ScreenWake.release("location") }
        .onChange(of: manager.contacts.count) { _, _ in fitCamera() }
    }

    // MARK: 共享开关

    private var shareCard: some View {
        BeeCard {
            HStack(spacing: BeeSpacing.md) {
                Image(systemName: manager.sharing ? "dot.radiowaves.left.and.right" : "location.fill")
                    .font(.title2)
                    .foregroundStyle(manager.sharing ? Color.beeSuccess : Color.beeHoney)
                    .frame(width: 34)
                VStack(alignment: .leading, spacing: 2) {
                    Text(manager.sharing ? LiveLocationStrings.sharingTitle(lang) : LiveLocationStrings.notSharingTitle(lang))
                        .font(.headline)
                    Text(sharingSubtitle).font(.caption).foregroundStyle(.secondary)
                }
                Spacer(minLength: 0)
                Button { manager.toggleSharing() } label: {
                    Text(manager.sharing ? LiveLocationStrings.stopSharing(lang) : LiveLocationStrings.startSharing(lang))
                        .font(.subheadline.weight(.semibold))
                        .padding(.horizontal, 14).padding(.vertical, 9)
                        .background(manager.sharing ? Color.beeDanger : Color.beeHoney, in: Capsule())
                        .foregroundStyle(manager.sharing ? Color.white : Color.beeInk)
                }
                .buttonStyle(BeePressStyle())
                .accessibilityLabel(manager.sharing ? LiveLocationStrings.stopSharing(lang) : LiveLocationStrings.startSharing(lang))
            }
        }
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(manager.sharing ? LiveLocationStrings.sharingTitle(lang) : LiveLocationStrings.notSharingTitle(lang))，\(sharingSubtitle)")
    }

    private var sharingSubtitle: String {
        if manager.authorizationDenied { return LiveLocationStrings.permissionDenied(lang) }
        if manager.sharing, manager.sharingUntil > Date().timeIntervalSince1970 * 1000 {
            return LiveLocationStrings.sharingUntil(timeString(manager.sharingUntil), lang)
        }
        return LiveLocationStrings.sharingHint(lang)
    }

    // MARK: 地图

    private var mapView: some View {
        Map(position: $camera) {
            UserAnnotation()
            ForEach(manager.contacts) { c in
                Annotation(c.displayName, coordinate: CLLocationCoordinate2D(latitude: c.lat, longitude: c.lng)) {
                    ZStack {
                        Circle().fill(Color.beeHoney).frame(width: 30, height: 30)
                            .overlay(Circle().strokeBorder(.white, lineWidth: 2))
                            .shadow(radius: 2)
                        Text(String(c.displayName.prefix(1)).uppercased())
                            .font(.caption.weight(.bold)).foregroundStyle(Color.beeInk)
                    }
                }
            }
        }
        .mapControls { MapUserLocationButton(); MapCompass() }
        .frame(height: 320)
        .clipShape(RoundedRectangle(cornerRadius: BeeRadius.card, style: .continuous))
        .accessibilityHidden(true) // 地图非无障碍要素；列表承担可达性
    }

    // MARK: 联系人列表

    private var contactsSection: some View {
        VStack(alignment: .leading, spacing: BeeSpacing.sm) {
            BeeSectionHeader(LiveLocationStrings.contactsHeader(lang), systemImage: "person.2.fill")
            if manager.contacts.isEmpty {
                BeeEmptyState(systemImage: "location.viewfinder",
                              title: LiveLocationStrings.noContactsTitle(lang),
                              message: LiveLocationStrings.noContactsMessage(lang))
            } else {
                ForEach(manager.contacts) { c in contactRow(c) }
            }
        }
    }

    private func contactRow(_ c: ContactLocationInfo) -> some View {
        let distanceText = distanceBearing(to: c)
        let accuracy = SharedLocationAccuracy.phrase(accuracyMeters: c.accuracy, language: lang, unit: unit) // nil=无精度信息，不显示
        let updated = LiveLocationStrings.updatedAgo(secondsSince(c.updatedAt), lang)
        let battery = LiveLocationStrings.batteryText(c.battery, lang) // nil=对端未上报（老客户端），不显示不猜
        let batteryLow = (c.battery ?? 100) <= 20
        // 仅当缓存地址仍对应联系人**当前**位置（updatedAt 未变）才显示——对方移动后旧地址过时，不再显示误导性旧位置。
        let cached = addresses[c.userId]
        let address = LiveLocationStrings.addressStillFresh(cachedUpdatedAt: cached?.at, currentUpdatedAt: c.updatedAt) ? cached?.text : nil
        return Button {
            // 盲人侧：地图不显示，点行=**读出对方所在街道地址**（看不到 pin 的刚需）；明眼侧：点行把地图移到其位置。
            if isBlind {
                Task { await loadAndSpeakAddress(c) }
            } else {
                camera = .region(MKCoordinateRegion(center: CLLocationCoordinate2D(latitude: c.lat, longitude: c.lng),
                                                     latitudinalMeters: 400, longitudinalMeters: 400))
            }
        } label: {
            BeeCard {
                HStack(spacing: BeeSpacing.md) {
                    AvatarView(dataURL: c.avatar, name: c.displayName, size: 40)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(c.displayName).font(.headline)
                        Text("\(AccountStrings.roleName(c.role, lang)) · \(distanceText)\(accuracy.map { " · \($0)" } ?? "")").font(.caption).foregroundStyle(.secondary)
                        if let battery {
                            // 低电量标红（对端手机快没电=其导盲/求助将失效，趁失联前主动联系）；视觉之外语义已在文字（"偏低"）。
                            Text("\(updated) · \(battery)").font(.caption2).foregroundStyle(batteryLow ? Color.beeDanger : Color.secondary)
                        } else {
                            Text(updated).font(.caption2).foregroundStyle(.secondary)
                        }
                        if let address {
                            // 已查到的所在街道地址（盲人听不到地图时的关键落点；明眼侧也顺带看到）。
                            Text("📍 \(address)").font(.caption2).foregroundStyle(.secondary)
                        }
                    }
                    Spacer(minLength: 0)
                    Circle().fill(Color.beeSuccess).frame(width: 9, height: 9)
                }
            }
        }
        .buttonStyle(BeePressStyle())
        .accessibilityElement(children: .combine)
        .accessibilityLabel(LiveLocationStrings.contactA11y(name: c.displayName, role: AccountStrings.roleName(c.role, lang),
                                                            distance: distanceText, accuracy: accuracy, updated: updated, battery: battery, address: address, lang))
        .accessibilityHint(isBlind ? LiveLocationStrings.viewAddressHint(lang) : "") // 盲人：告知双击可听所在地址
    }

    /// 盲人点联系人行：把其位置逆地理成街道地址并**读出**（查不到显式告知，绝不编造）。
    @MainActor private func loadAndSpeakAddress(_ c: ContactLocationInfo) async {
        // 已查过且仍对应**当前**位置：直接复听，不再打高德。对方已移动（updatedAt 变了）→ 视为未缓存、重新逆地理，绝不复述旧位置。
        if let cached = addresses[c.userId], LiveLocationStrings.addressStillFresh(cachedUpdatedAt: cached.at, currentUpdatedAt: c.updatedAt) {
            SpeechHub.shared.speak(LiveLocationStrings.contactAtAddressSpeak(name: c.displayName, address: cached.text, lang), channel: .query, voiceCode: lang.voiceCode)
            return
        }
        guard let token = session.token, !addressLoadingIds.contains(c.userId) else { return }
        addressLoadingIds.insert(c.userId)
        SpeechHub.shared.speak(LiveLocationStrings.addressLoadingSpeak(lang), channel: .query, voiceCode: lang.voiceCode)
        let info = await APIClient().contactAddress(token: token, userId: c.userId)
        addressLoadingIds.remove(c.userId)
        if let info, let text = LiveLocationStrings.contactAddressText(address: info.address, township: info.township, aoiName: info.aoi?.name, aoiDistanceMeters: info.aoi?.distanceMeters, firstRoad: info.intersection?.firstRoad, secondRoad: info.intersection?.secondRoad, landmarkName: info.landmark?.name, lang) {
            addresses[c.userId] = (text, c.updatedAt) // 记下对应的 updatedAt：对方下次移动后此地址即被判过时、重查
            SpeechHub.shared.speak(LiveLocationStrings.contactAtAddressSpeak(name: c.displayName, address: text, lang), channel: .query, voiceCode: lang.voiceCode)
        } else {
            SpeechHub.shared.speak(LiveLocationStrings.addressUnavailableSpeak(lang), channel: .query, voiceCode: lang.voiceCode)
        }
    }

    // MARK: 计算

    /// 距离 + 方位（需本机正在共享/有定位才能算出方向；否则仅"距离未知"）。
    private func distanceBearing(to c: ContactLocationInfo) -> String {
        guard let me = manager.lastCoordinate else { return LiveLocationStrings.distanceUnknown(lang) }
        let meters = Int(Geo.distanceMeters(fromLat: me.latitude, fromLon: me.longitude, toLat: c.lat, toLon: c.lng).rounded())
        let bearing = Geo.initialBearing(fromLat: me.latitude, fromLon: me.longitude, toLat: c.lat, toLon: c.lng)
        var s = LiveLocationStrings.distanceBearing(meters: meters, bearing: LiveLocationStrings.compass(bearing, lang), unit: unit, lang)
        // 移动趋势（对端在行进时才有 heading）：正朝你靠近/正在远离——盲人等人来或知对方离开的关键。之前 heading
        // 字段一路传到端却从未播出（死字段）；此处兑现（横向移动不播，避免侧向被误说成靠近/远离）。
        if let h = c.heading, h.isFinite,
           let phrase = LiveLocationStrings.movementPhrase(LiveLocationStrings.relativeMovement(headingDegrees: h, bearingToContactDegrees: bearing), lang) {
            s += phrase
        }
        return s
    }

    private func secondsSince(_ ms: Double) -> Int { max(0, Int((Date().timeIntervalSince1970 * 1000 - ms) / 1000)) }

    private func timeString(_ ms: Double) -> String {
        let date = Date(timeIntervalSince1970: ms / 1000)
        let f = DateFormatter(); f.locale = lang == .zh ? Locale(identifier: "zh_CN") : Locale(identifier: "en_US")
        f.timeStyle = .short; f.dateStyle = .none
        return f.string(from: date)
    }

    private func fitCamera() {
        let pts = manager.contacts.map { CLLocationCoordinate2D(latitude: $0.lat, longitude: $0.lng) }
        guard let first = pts.first else { return }
        if pts.count == 1 {
            camera = .region(MKCoordinateRegion(center: first, latitudinalMeters: 600, longitudinalMeters: 600))
        }
    }
}
