import AppIntents
import Foundation
import Observation

/// Siri/快捷指令 → 界面动作的路由（盲人逐层找按钮成本高，一句话直达，参考 Be My Eyes/VoiceVista）。
@MainActor
@Observable
final class AppRoute {
    static let shared = AppRoute()
    enum Destination { case help, lookAround, whereAmI }
    /// 识别屏内的频道直达（Seeing AI"全频道快捷指令"惯例：一句话直达识币/扫码等具体动作）。
    enum FramingChannel { case banknote, scan, fullPage, bus, people, light }
    var pending: Destination?
    var pendingChannel: FramingChannel?
    private init() {}
}

/// 「嘿 Siri，用蜂有眼呼叫帮手」——直达求助界面。
struct CallHelpIntent: AppIntent {
    static let title: LocalizedStringResource = "呼叫帮手"
    static let description = IntentDescription("打开求助界面，呼叫志愿者或亲友帮你看")
    static let openAppWhenRun = true
    @MainActor func perform() async throws -> some IntentResult {
        AppRoute.shared.pending = .help
        return .result()
    }
}

/// 「嘿 Siri，用蜂有眼看一看」——直达物体识别/读字。
struct LookAroundIntent: AppIntent {
    static let title: LocalizedStringResource = "看一看"
    static let description = IntentDescription("打开识别界面：认物体、读文字、辨颜色、扫码")
    static let openAppWhenRun = true
    @MainActor func perform() async throws -> some IntentResult {
        AppRoute.shared.pending = .lookAround
        return .result()
    }
}

/// 「嘿 Siri，用蜂有眼我在哪」——播报当前位置与附近地点。
struct WhereAmIIntent: AppIntent {
    static let title: LocalizedStringResource = "我在哪"
    static let description = IntentDescription("语音播报你当前的大概位置和附近地标")
    static let openAppWhenRun = true
    @MainActor func perform() async throws -> some IntentResult {
        AppRoute.shared.pending = .whereAmI
        return .result()
    }
}

/// 频道直达 Intent 的公共路由：打开识别屏并在首帧就绪后自动触发对应动作。
@MainActor
private func routeToChannel(_ channel: AppRoute.FramingChannel) {
    AppRoute.shared.pendingChannel = channel
    AppRoute.shared.pending = .lookAround
}

/// 「嘿 Siri，用蜂有眼识别纸币」——直达识币。
struct ReadBanknoteIntent: AppIntent {
    static let title: LocalizedStringResource = "识别纸币"
    static let description = IntentDescription("打开相机识别人民币纸币的面额")
    static let openAppWhenRun = true
    @MainActor func perform() async throws -> some IntentResult {
        routeToChannel(.banknote)
        return .result()
    }
}

/// 「嘿 Siri，用蜂有眼扫码」——直达扫码（商品条码/二维码）。
struct ScanCodeIntent: AppIntent {
    static let title: LocalizedStringResource = "扫码"
    static let description = IntentDescription("打开相机扫商品条码或二维码并朗读内容")
    static let openAppWhenRun = true
    @MainActor func perform() async throws -> some IntentResult {
        routeToChannel(.scan)
        return .result()
    }
}

/// 「嘿 Siri，用蜂有眼读整页」——直达多页文档朗读。
struct ReadFullPageIntent: AppIntent {
    static let title: LocalizedStringResource = "读整页"
    static let description = IntentDescription("引导对准整页纸张，自动拍摄并按顺序朗读全文，可连续多页")
    static let openAppWhenRun = true
    @MainActor func perform() async throws -> some IntentResult {
        routeToChannel(.fullPage)
        return .result()
    }
}

/// 「嘿 Siri，用蜂有眼公交识别」——直达车头牌朗读。
struct ReadBusIntent: AppIntent {
    static let title: LocalizedStringResource = "公交识别"
    static let description = IntentDescription("认出进站的公交车或电车，朗读线路号和终点站")
    static let openAppWhenRun = true
    @MainActor func perform() async throws -> some IntentResult {
        routeToChannel(.bus)
        return .result()
    }
}

/// 「嘿 Siri，用蜂有眼周围的人」——直达人物感知。
struct PeopleNearbyIntent: AppIntent {
    static let title: LocalizedStringResource = "周围的人"
    static let description = IntentDescription("数一数前方有几个人，报方位和距离，不识别身份")
    static let openAppWhenRun = true
    @MainActor func perform() async throws -> some IntentResult {
        routeToChannel(.people)
        return .result()
    }
}

/// 「嘿 Siri，用蜂有眼光线探测」——直达光线探测。
struct ReadLightIntent: AppIntent {
    static let title: LocalizedStringResource = "光线探测"
    static let description = IntentDescription("报告环境明暗和亮光的方向，帮你找窗户或灯")
    static let openAppWhenRun = true
    @MainActor func perform() async throws -> some IntentResult {
        routeToChannel(.light)
        return .result()
    }
}

struct BeeAppShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(intent: CallHelpIntent(),
                    phrases: ["用\(.applicationName)呼叫帮手", "在\(.applicationName)求助", "\(.applicationName)帮我看"],
                    shortTitle: "求助", systemImageName: "hand.raised.fill")
        AppShortcut(intent: LookAroundIntent(),
                    phrases: ["用\(.applicationName)看一看", "让\(.applicationName)认一下这是什么"],
                    shortTitle: "看一看", systemImageName: "viewfinder")
        AppShortcut(intent: WhereAmIIntent(),
                    phrases: ["用\(.applicationName)我在哪", "问\(.applicationName)我在哪里"],
                    shortTitle: "我在哪", systemImageName: "location.fill")
        AppShortcut(intent: ReadBanknoteIntent(),
                    phrases: ["用\(.applicationName)识别纸币", "让\(.applicationName)看看这是多少钱"],
                    shortTitle: "识别纸币", systemImageName: "banknote.fill")
        AppShortcut(intent: ScanCodeIntent(),
                    phrases: ["用\(.applicationName)扫码", "让\(.applicationName)扫一下条码"],
                    shortTitle: "扫码", systemImageName: "qrcode.viewfinder")
        AppShortcut(intent: ReadFullPageIntent(),
                    phrases: ["用\(.applicationName)读整页", "让\(.applicationName)读这页纸"],
                    shortTitle: "读整页", systemImageName: "doc.text.viewfinder")
        AppShortcut(intent: ReadBusIntent(),
                    phrases: ["用\(.applicationName)公交识别", "让\(.applicationName)看看是几路车"],
                    shortTitle: "公交识别", systemImageName: "bus.fill")
        AppShortcut(intent: PeopleNearbyIntent(),
                    phrases: ["用\(.applicationName)周围的人", "问\(.applicationName)前面有没有人"],
                    shortTitle: "周围的人", systemImageName: "person.2.fill")
        AppShortcut(intent: ReadLightIntent(),
                    phrases: ["用\(.applicationName)光线探测", "问\(.applicationName)灯开着吗"],
                    shortTitle: "光线", systemImageName: "sun.max.fill")
    }
}
