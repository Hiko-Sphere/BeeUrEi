import Foundation
import Security

/// 把登录凭据存进 Keychain（比 UserDefaults 安全）。支持多键（access + refresh token）。
enum KeychainStore {
    private static let service = "com.beeurei.BeeUrEi"

    static func save(_ value: String, account: String = "authToken") {
        let base: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(base as CFDictionary)
        var add = base
        add[kSecValueData as String] = Data(value.utf8)
        // ThisDeviceOnly：令牌**不随**加密备份/iCloud 钥匙串迁移到其它设备——长期 refresh token 跟着备份搬走是真实泄露面。
        // AfterFirstUnlock：设备首次解锁后即可读（含锁屏时的后台心跳/轮询），避免锁屏时读不到令牌（见审查：令牌存储）。
        add[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        SecItemAdd(add as CFDictionary, nil)
    }

    static func read(account: String = "authToken") -> String? {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
            kSecReturnData as String: true,
            kSecMatchLimit as String: kSecMatchLimitOne,
        ]
        var item: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &item) == errSecSuccess,
              let data = item as? Data else { return nil }
        return String(data: data, encoding: .utf8)
    }

    static func delete(account: String = "authToken") {
        let query: [String: Any] = [
            kSecClass as String: kSecClassGenericPassword,
            kSecAttrService as String: service,
            kSecAttrAccount as String: account,
        ]
        SecItemDelete(query as CFDictionary)
    }

    // MARK: refresh token 便捷
    static func saveRefresh(_ token: String) { save(token, account: "refreshToken") }
    static func readRefresh() -> String? { read(account: "refreshToken") }
    static func deleteRefresh() { delete(account: "refreshToken") }
}
