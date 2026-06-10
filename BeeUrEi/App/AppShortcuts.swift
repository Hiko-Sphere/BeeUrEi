import AppIntents
import Foundation
import Observation

/// Siri/快捷指令 → 界面动作的路由（盲人逐层找按钮成本高，一句话直达，参考 Be My Eyes/VoiceVista）。
@MainActor
@Observable
final class AppRoute {
    static let shared = AppRoute()
    enum Destination { case help, lookAround, whereAmI }
    var pending: Destination?
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
    }
}
