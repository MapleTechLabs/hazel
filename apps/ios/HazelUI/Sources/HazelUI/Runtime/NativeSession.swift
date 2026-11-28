import Foundation
import JavaScriptCore
import Network
import Security
import UIKit

/// The session's one keychain record (`@hazel/auth/desktop`'s vault JSON), the same item the hybrid
/// app's `HostBridge.Vault` keeps, so a session signed in there carries over. JS reads the credential
/// from it (`packages/client-data/src/platform/jsc/session.ts`).
public final class NativeSession: @unchecked Sendable {
    /// Posted on the main queue when the API refuses the session (a 401 on the token exchange), as
    /// the web dispatches `hazel:session-rejected`; the shell decides what follows (sign-in).
    public static let rejectedNotification = Notification.Name("sh.hazel.session-rejected")

    func object(in context: JSContext) -> JSValue {
        let read: @convention(block) () -> Any = { NativeVault.read() ?? NSNull() }
        let write: @convention(block) (String) -> Bool = { record in NativeVault.write(record) }
        let clear: @convention(block) () -> Void = { NativeVault.clear() }
        let rejected: @convention(block) () -> Void = {
            NativePlatform.log.log("[session] the API refused the session")
            DispatchQueue.main.async { NotificationCenter.default.post(name: Self.rejectedNotification, object: nil) }
        }
        let object = JSValue(newObjectIn: context)!
        object.setObject(read, forKeyedSubscript: "read" as NSString)
        object.setObject(write, forKeyedSubscript: "write" as NSString)
        object.setObject(clear, forKeyedSubscript: "clear" as NSString)
        object.setObject(rejected, forKeyedSubscript: "rejected" as NSString)
        return object
    }
}

/// The keychain item, readable after first unlock on this device only. A simulator build signed
/// without entitlements cannot use the keychain (`errSecMissingEntitlement`); it keeps the record in
/// `UserDefaults` under the hybrid's key instead.
public enum NativeVault {
    private static let fallbackKey = "sh.hazel.auth.session"
    private static var query: [CFString: Any] { [
        kSecClass: kSecClassGenericPassword,
        kSecAttrService: "sh.hazel.auth",
        kSecAttrAccount: "session",
    ] }

    public static func read() -> String? {
        var lookup = query
        lookup[kSecReturnData] = true
        lookup[kSecMatchLimit] = kSecMatchLimitOne
        var result: CFTypeRef?
        let status = SecItemCopyMatching(lookup as CFDictionary, &result)
        if status == errSecSuccess, let data = result as? Data { return String(decoding: data, as: UTF8.self) }
        return usesFallback(status) ? UserDefaults.standard.string(forKey: fallbackKey) : nil
    }

    @discardableResult
    public static func write(_ record: String) -> Bool {
        let data = Data(record.utf8)
        let status = SecItemUpdate(query as CFDictionary, [kSecValueData: data] as CFDictionary)
        if status == errSecSuccess { return true }
        if status == errSecItemNotFound {
            var add = query
            add[kSecValueData] = data
            add[kSecAttrAccessible] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
            let added = SecItemAdd(add as CFDictionary, nil)
            if added == errSecSuccess { return true }
            if !usesFallback(added) {
                NativePlatform.log.error("[session] keychain write failed: \(added)")
                return false
            }
        } else if !usesFallback(status) {
            NativePlatform.log.error("[session] keychain update failed: \(status)")
            return false
        }
        UserDefaults.standard.set(record, forKey: fallbackKey)
        return true
    }

    public static func clear() {
        SecItemDelete(query as CFDictionary)
        UserDefaults.standard.removeObject(forKey: fallbackKey)
    }

    private static func usesFallback(_ status: OSStatus) -> Bool {
        #if targetEnvironment(simulator)
        return status == errSecMissingEntitlement || status == errSecItemNotFound
        #else
        return false
        #endif
    }
}

/// `Connectivity` over `NWPathMonitor`: listeners hear each return to a satisfied path, as the
/// web's `online` event.
final class NativeConnectivity: @unchecked Sendable {
    private let pump: JSCallbackPump
    private let monitor = NWPathMonitor()
    private let lock = NSLock()
    private var listeners: [Int: JSCallback] = [:]
    private var nextId = 1
    private var satisfied: Bool?

    init(pump: JSCallbackPump) {
        self.pump = pump
        monitor.pathUpdateHandler = { [weak self] path in self?.update(path.status == .satisfied) }
        monitor.start(queue: DispatchQueue(label: "sh.hazel.platform.connectivity"))
    }

    deinit { monitor.cancel() }

    func object(in context: JSContext) -> JSValue {
        let on: @convention(block) (JSValue) -> Int = { [weak self] listener in
            guard let self else { return 0 }
            return self.add(JSCallback(listener, pump: self.pump))
        }
        let off: @convention(block) (Int) -> Void = { [weak self] id in self?.remove(id) }
        let object = JSValue(newObjectIn: context)!
        object.setObject(on, forKeyedSubscript: "onOnline" as NSString)
        object.setObject(off, forKeyedSubscript: "off" as NSString)
        return object
    }

    private func update(_ now: Bool) {
        lock.lock()
        let wasOffline = satisfied == false
        satisfied = now
        let toCall = now && wasOffline ? Array(listeners.values) : []
        lock.unlock()
        if !toCall.isEmpty { NativePlatform.log.log("[platform] network back, \(toCall.count) listeners") }
        for listener in toCall { listener.call([]) }
    }

    private func add(_ listener: JSCallback) -> Int {
        lock.lock()
        defer { lock.unlock() }
        let id = nextId
        nextId += 1
        listeners[id] = listener
        return id
    }

    private func remove(_ id: Int) {
        lock.lock()
        listeners[id] = nil
        lock.unlock()
    }
}

/// `Clipboard.write`: `UIPasteboard`, set on the main queue (the JS thread never waits for it).
enum NativeClipboard {
    static func object(in context: JSContext) -> JSValue {
        let write: @convention(block) (String) -> Bool = { text in
            DispatchQueue.main.async { UIPasteboard.general.string = text }
            return true
        }
        let object = JSValue(newObjectIn: context)!
        object.setObject(write, forKeyedSubscript: "write" as NSString)
        return object
    }
}
