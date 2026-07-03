import Foundation
import UIKit

/// 无网兜底拨号缓存：把「该拨给谁」提前算好存本地——告警失败的那一刻**没有网络**，现查 API 不可能。
/// 数据入口唯一（APIClient.familyLinks 每次拉取顺手刷新）；挑人逻辑在核心 EmergencyPhoneFallback（已测）。
/// 只存显示名+净化后的 tel URL（非敏感新增：电话本就是用户为兜底手输的）。
enum EmergencyDialCache {
    private static let nameKey = "emergencyDial.name"
    private static let urlKey = "emergencyDial.telURL"

    static func update(from links: [FamilyLinkInfo]) {
        let candidates = links.map {
            EmergencyPhoneFallback.Candidate(name: $0.memberName, phone: $0.phone ?? "",
                                             isEmergency: $0.isEmergency, isAccepted: $0.isAccepted)
        }
        let d = UserDefaults.standard
        if let pick = EmergencyPhoneFallback.pick(candidates), let url = EmergencyPhoneFallback.telURLString(pick.phone) {
            d.set(pick.name, forKey: nameKey)
            d.set(url, forKey: urlKey)
        } else {
            d.removeObject(forKey: nameKey) // 没有可拨对象：清掉旧缓存，绝不拨给已解绑的人
            d.removeObject(forKey: urlKey)
        }
    }

    /// 登出即清：UserDefaults 键是全局的——不清则**上一个账号**的紧急联系人残留（隐私残留 +
    /// 换账号后告警失败可能拨给前任用户的家人）。与 LiveLocationManager.reset 同一防跨账号泄漏口径。
    static func clear() {
        UserDefaults.standard.removeObject(forKey: nameKey)
        UserDefaults.standard.removeObject(forKey: urlKey)
    }

    static var cached: (name: String, url: URL)? {
        let d = UserDefaults.standard
        guard let name = d.string(forKey: nameKey), let s = d.string(forKey: urlKey), let url = URL(string: s) else { return nil }
        return (name, url)
    }

    /// 告警彻底失败（重试全败=多半无数据网络）时调用：播报并唤起系统拨号确认（tel: 走蜂窝语音，
    /// 不依赖数据网络；系统会弹"呼叫 …?"确认，VoiceOver 可确认/取消——不静默直拨）。
    @MainActor
    static func dialFallbackIfAvailable(lang: Language, speak: (String) -> Void) {
        guard let (name, url) = cached else { return }
        speak(HomeStrings.dialingFallback(name, lang))
        UIApplication.shared.open(url)
    }
}
