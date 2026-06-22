import Foundation
import LocalAuthentication

/// 应用锁 / 身份验证相关文案（双语 zh/en）。
enum SecurityStrings {

    /// 生物识别类型名（Face ID / Touch ID / Optic ID / 设备密码）。
    static func biometryName(_ t: LABiometryType, _ l: Language) -> String {
        switch t {
        case .faceID: return "Face ID"
        case .touchID: return "Touch ID"
        case .opticID: return "Optic ID"
        default: return l == .zh ? "设备密码" : "device passcode"
        }
    }

    // MARK: 设置项

    static func sectionHeader(_ l: Language) -> String { l == .zh ? "应用锁" : "App Lock" }
    static func sectionFooter(_ t: LABiometryType, _ l: Language) -> String {
        let name = biometryName(t, l)
        if l == .zh {
            return "开启后，每次打开 App 都需用 \(name) 验证本人，才能进入；保护你的账号、实时位置、录音与亲友信息。来电不受影响。"
        }
        return "When on, opening the app requires \(name) to confirm it's you — protecting your account, live location, recordings and family info. Incoming calls are not blocked."
    }
    /// 开关标题：「使用 Face ID 解锁」。
    static func toggleLabel(_ t: LABiometryType, _ l: Language) -> String {
        let name = biometryName(t, l)
        return l == .zh ? "用 \(name) 解锁" : "Unlock with \(name)"
    }
    /// 设备未设密码、无法启用时的说明。
    static func noPasscodeFooter(_ l: Language) -> String {
        l == .zh ? "请先在系统「设置 › 面容/触控 ID 与密码」中设置设备密码或生物识别，才能开启应用锁。"
                 : "Set a device passcode or biometrics in the system Settings first to enable App Lock."
    }

    // MARK: 锁屏

    static func lockedTitle(_ l: Language) -> String { l == .zh ? "已锁定" : "Locked" }
    static func lockedSubtitle(_ t: LABiometryType, _ l: Language) -> String {
        let name = biometryName(t, l)
        return l == .zh ? "用 \(name) 验证本人以继续" : "Verify with \(name) to continue"
    }
    static func unlock(_ l: Language) -> String { l == .zh ? "解锁" : "Unlock" }
    /// 传给系统验证弹窗的 localizedReason。
    static func unlockReason(_ l: Language) -> String {
        l == .zh ? "验证本人以打开 BeeUrEi" : "Verify it's you to open BeeUrEi"
    }
    static func enableReason(_ l: Language) -> String {
        l == .zh ? "验证本人以开启应用锁" : "Verify it's you to turn on App Lock"
    }

    // MARK: 验证结果

    static func authCancelled(_ l: Language) -> String { l == .zh ? "验证已取消，请点「解锁」重试" : "Verification cancelled — tap Unlock to retry" }
    static func authFailed(_ l: Language) -> String { l == .zh ? "验证未通过，请重试" : "Verification failed — please try again" }
    static func authUnavailable(_ l: Language) -> String {
        l == .zh ? "暂时无法验证：请检查系统的面容/触控 ID 与密码设置" : "Verification unavailable — check Face/Touch ID & passcode in system settings"
    }
    static func authLockout(_ l: Language) -> String {
        l == .zh ? "生物识别已被锁定，请用设备密码验证" : "Biometrics locked — use your device passcode"
    }
}
