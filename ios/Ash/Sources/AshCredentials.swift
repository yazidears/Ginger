import Foundation
import Security

enum AshCredentials {
    static func token(for server: String) -> String {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "ai.ginger.ash", kSecAttrAccount as String: server, kSecReturnData as String: true]
        var result: CFTypeRef?
        guard SecItemCopyMatching(query as CFDictionary, &result) == errSecSuccess, let data = result as? Data else { return "" }
        return String(data: data, encoding: .utf8) ?? ""
    }
    static func save(_ token: String, for server: String) throws {
        let query: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "ai.ginger.ash", kSecAttrAccount as String: server]
        if token.isEmpty { SecItemDelete(query as CFDictionary); return }
        let values: [String: Any] = [kSecValueData as String: Data(token.utf8), kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
        let update = SecItemUpdate(query as CFDictionary, values as CFDictionary)
        if update == errSecItemNotFound {
            var item = query; values.forEach { item[$0.key] = $0.value }
            guard SecItemAdd(item as CFDictionary, nil) == errSecSuccess else { throw GingerClient.ClientError.message("Could not store the Ash token in Keychain.") }
        } else if update != errSecSuccess { throw GingerClient.ClientError.message("Could not update the Ash token.") }
    }
}
