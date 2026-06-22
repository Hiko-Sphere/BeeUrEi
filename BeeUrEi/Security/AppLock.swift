import Foundation
import LocalAuthentication
import Observation

/// 应用锁（生物识别 / 设备密码）。开启后，每次把 App 切回前台都需用 Face ID / Touch ID（失败可回退设备密码）
/// 验证本人，才能进入——保护账号与首屏上的敏感数据（实时位置 / 我的录音 / 亲友与紧急 / 账号与安全）。
///
/// 纯端侧：LocalAuthentication + Secure Enclave，**不落任何密钥、不经后端**。用 `.deviceOwnerAuthentication`
/// 策略（而非仅 `...WithBiometrics`），生物识别失败/被锁定时系统会回退到设备密码，杜绝把用户锁死在外。
@MainActor
@Observable
final class AppLock {
    static let shared = AppLock()

    private let enabledKey = "security.appLockEnabled"

    /// 是否开启应用锁（持久化偏好）。
    private(set) var enabled: Bool
    /// 运行时是否处于锁定态（需验证才能进入）。
    private(set) var isLocked: Bool
    /// 最近一次验证失败/取消的可读原因（锁屏展示 + 朗读）。
    private(set) var lastError: String?
    /// 正在验证中（防重复触发系统弹窗）。
    private(set) var authenticating = false

    private init() {
        let on = UserDefaults.standard.bool(forKey: enabledKey)
        self.enabled = on
        self.isLocked = on    // 冷启动即锁（开启时）
    }

    // MARK: 设备能力

    /// 当前设备的生物识别类型（用于文案：Face ID / Touch ID / Optic ID / 无）。
    static func biometryType() -> LABiometryType {
        let ctx = LAContext()
        _ = ctx.canEvaluatePolicy(.deviceOwnerAuthentication, error: nil) // 须先 canEvaluate 才能读到 biometryType
        return ctx.biometryType
    }

    /// 设备是否可做任意本人验证（已设生物识别或设备密码）。未设密码的设备无法启用应用锁。
    static func canAuthenticate() -> Bool {
        LAContext().canEvaluatePolicy(.deviceOwnerAuthentication, error: nil)
    }

    // MARK: 生命周期

    /// 进入后台：若已开启则锁定，使下次回前台必须重新验证。验证进行中不强改（让在途验证自行收敛，避免竞态）。
    func lockOnBackground() {
        guard enabled, !authenticating else { return }
        isLocked = true
    }

    // MARK: 验证

    /// 验证本人；成功则解锁。供锁屏（自动触发 + 「解锁」按钮重试）调用。
    func authenticate(reason: String) async {
        guard !authenticating else { return }
        authenticating = true
        lastError = nil
        let result = await Self.evaluate(reason: reason)
        switch result {
        case .success(let ok):
            isLocked = !ok
            if !ok { lastError = SecurityStrings.authCancelled(FeatureSettings().language) }
        case .failure(let err):
            // 防永久锁死：若设备已无任何验证手段（移除了密码与生物识别），既无法验证也无从再保护——
            // 直接关闭应用锁并放行（用 disable 一并清掉 enabled，避免下次切后台又锁、反复弹窗抖动）。
            if !Self.canAuthenticate() {
                disable()
            } else {
                isLocked = true
                lastError = Self.message(for: err)
            }
        }
        authenticating = false
    }

    /// 开启前先验证一次本人，确认设备可正常验证（失败则不开启），避免开启后回前台却无法解锁。
    /// 返回是否成功开启。
    func enableWithAuth(reason: String) async -> Bool {
        guard !authenticating else { return false }
        authenticating = true
        defer { authenticating = false }
        let result = await Self.evaluate(reason: reason)
        if case .success(true) = result {
            enabled = true
            UserDefaults.standard.set(true, forKey: enabledKey)
            isLocked = false
            lastError = nil
            return true
        }
        if case .failure(let err) = result { lastError = Self.message(for: err) }
        return false
    }

    /// 关闭应用锁（当前已在已解锁的设置页内操作，无需再次验证）。
    func disable() {
        enabled = false
        UserDefaults.standard.set(false, forKey: enabledKey)
        isLocked = false
        lastError = nil
    }

    // MARK: 内部

    /// 把基于回调的 evaluatePolicy 包成 async。完成回调在任意队列，因本类型 @MainActor，await 之后回到主线程。
    private static func evaluate(reason: String) async -> Result<Bool, Error> {
        let ctx = LAContext()
        ctx.localizedFallbackTitle = ""   // 用系统默认「输入密码」回退项
        return await withCheckedContinuation { cont in
            ctx.evaluatePolicy(.deviceOwnerAuthentication, localizedReason: reason) { ok, err in
                if let err { cont.resume(returning: .failure(err)) }
                else { cont.resume(returning: .success(ok)) }
            }
        }
    }

    /// 把 LAError 映射为可读双语原因。
    private static func message(for error: Error) -> String {
        let lang = FeatureSettings().language
        guard let la = error as? LAError else { return error.localizedDescription }
        switch la.code {
        case .userCancel, .appCancel, .systemCancel:
            return SecurityStrings.authCancelled(lang)
        case .userFallback:
            return SecurityStrings.authCancelled(lang)
        case .biometryNotAvailable, .biometryNotEnrolled, .passcodeNotSet:
            return SecurityStrings.authUnavailable(lang)
        case .biometryLockout:
            return SecurityStrings.authLockout(lang)
        default:
            return SecurityStrings.authFailed(lang)
        }
    }
}
