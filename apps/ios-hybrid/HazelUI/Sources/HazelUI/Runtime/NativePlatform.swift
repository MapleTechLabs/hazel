import Foundation
import JavaScriptCore
import os
import Security

/// The data layer's platform services for a JavaScriptCore context (`docs/hazel-ui.md`, "Platform
/// services"): installs `__native.{uuid, kv, socket, http, connectivity, session, sqlite, files,
/// clipboard, config, auth}`. The contract is `packages/client-data/src/platform/jsc/bridge.ts`.
public final class NativePlatform: @unchecked Sendable {
    public static let log = Logger(subsystem: "sh.hazel.ui", category: "platform")

    /// Runs a block on the JS thread. Swift calls JS only through it.
    public typealias Perform = @Sendable (@escaping @Sendable () -> Void) -> Void

    public let config: NativePlatformConfig
    let pump: JSCallbackPump
    let sockets: NativeSockets
    let http: NativeHttp
    let connectivity: NativeConnectivity
    let session: NativeSession
    let sqlite: NativeSQLite
    let files: NativeFiles
    let auth: NativeAuth

    private init(perform: @escaping Perform, config: NativePlatformConfig) {
        self.config = config
        pump = JSCallbackPump(perform: perform)
        sockets = NativeSockets(pump: pump)
        http = NativeHttp(pump: pump)
        connectivity = NativeConnectivity(pump: pump)
        session = NativeSession()
        sqlite = NativeSQLite(pump: pump)
        files = NativeFiles(pump: pump)
        auth = NativeAuth(pump: pump)
    }

    /// Kept for the app's lifetime, as the context is.
    nonisolated(unsafe) private static var installed: [NativePlatform] = []

    /// Adds the services to `context`'s `__native` (created if missing). Call on the JS thread
    /// (`JSEngine`'s ready hooks); `perform` hops back onto it.
    @discardableResult
    public static func install(
        in context: JSContext,
        config: NativePlatformConfig = .fromEnvironment(),
        perform: @escaping Perform
    ) -> NativePlatform {
        let platform = NativePlatform(perform: perform, config: config)
        installed.append(platform)
        let native: JSValue
        if let existing = context.objectForKeyedSubscript("__native"), existing.isObject {
            native = existing
        } else {
            native = JSValue(newObjectIn: context)
            context.setObject(native, forKeyedSubscript: "__native" as NSString)
        }
        let uuid: @convention(block) () -> String = { UUID().uuidString.lowercased() }
        native.setObject(uuid, forKeyedSubscript: "uuid" as NSString)
        // `crypto.getRandomValues` (the JS shim): the system's secure random, as a `Uint8Array`.
        let randomBytes: @convention(block) (Int) -> JSValue = { count in
            var bytes = Data(count: max(0, min(count, 65536)))
            let size = bytes.count
            _ = bytes.withUnsafeMutableBytes { SecRandomCopyBytes(kSecRandomDefault, size, $0.baseAddress!) }
            return JSBytes.uint8Array(bytes, in: JSContext.current())
        }
        native.setObject(randomBytes, forKeyedSubscript: "randomBytes" as NSString)
        native.setObject(NativeKeyValue.object(in: context), forKeyedSubscript: "kv" as NSString)
        native.setObject(platform.sockets.object(in: context), forKeyedSubscript: "socket" as NSString)
        native.setObject(platform.http.object(in: context), forKeyedSubscript: "http" as NSString)
        native.setObject(platform.connectivity.object(in: context), forKeyedSubscript: "connectivity" as NSString)
        native.setObject(platform.session.object(in: context), forKeyedSubscript: "session" as NSString)
        native.setObject(platform.sqlite.object(in: context), forKeyedSubscript: "sqlite" as NSString)
        native.setObject(platform.files.object(in: context), forKeyedSubscript: "files" as NSString)
        native.setObject(NativeClipboard.object(in: context), forKeyedSubscript: "clipboard" as NSString)
        native.setObject(platform.auth.object(in: context), forKeyedSubscript: "auth" as NSString)
        native.setObject(config.object(in: context), forKeyedSubscript: "config" as NSString)
        log.log("[platform] installed, api \(config.apiUrl, privacy: .public)")
        return platform
    }
}

/// The server this build talks to.
public struct NativePlatformConfig: Sendable {
    public let apiUrl: String
    /// A stand-in session for a local fixture server, used while the keychain holds none. Never
    /// set for any other server.
    public let standInToken: String?

    public init(apiUrl: String, standInToken: String? = nil) {
        self.apiUrl = apiUrl
        self.standInToken = Self.isLoopback(apiUrl) ? standInToken : nil
    }

    /// `HAZEL_API_URL` from the launch environment, the local fixture backend otherwise; on a
    /// loopback server, `HAZEL_TOKEN` (default `fixture`) as the stand-in session.
    public static func fromEnvironment() -> NativePlatformConfig {
        let env = ProcessInfo.processInfo.environment
        return NativePlatformConfig(
            apiUrl: env["HAZEL_API_URL"] ?? "http://127.0.0.1:4320",
            standInToken: env["HAZEL_TOKEN"] ?? "fixture"
        )
    }

    static func isLoopback(_ url: String) -> Bool {
        guard let host = URL(string: url)?.host?.lowercased() else { return false }
        return host == "127.0.0.1" || host == "localhost" || host == "::1"
    }

    func object(in context: JSContext) -> JSValue {
        let object = JSValue(newObjectIn: context)!
        object.setObject(apiUrl, forKeyedSubscript: "apiUrl" as NSString)
        object.setObject(standInToken.map { $0 as Any } ?? NSNull(), forKeyedSubscript: "token" as NSString)
        return object
    }
}

/// JS callbacks due from other threads, run in as few JS turns as possible: every callback queued
/// before the JS thread gets to them runs in one turn (G4: 100 separate turns cost about 45 ms).
final class JSCallbackPump: @unchecked Sendable {
    /// Builds a callback's arguments on the JS thread (typed arrays need the context).
    typealias Arguments = @Sendable (JSContext) -> [Any]

    private let perform: NativePlatform.Perform
    private let lock = NSLock()
    private var pending: [(JSValue, Arguments)] = []
    private var scheduled = false

    init(perform: @escaping NativePlatform.Perform) { self.perform = perform }

    func post(_ callback: JSValue, _ arguments: @escaping Arguments) {
        lock.lock()
        pending.append((callback, arguments))
        let schedule = !scheduled
        scheduled = true
        lock.unlock()
        if schedule { perform { [self] in self.flush() } }
    }

    private func flush() {
        lock.lock()
        let due = pending
        pending = []
        scheduled = false
        lock.unlock()
        for (callback, arguments) in due {
            guard let context = callback.context else { continue }
            callback.call(withArguments: arguments(context))
        }
    }
}

/// A JS function Swift calls back later, through the pump (onto the JS thread).
final class JSCallback: @unchecked Sendable {
    private let value: JSValue
    private let pump: JSCallbackPump

    init(_ value: JSValue, pump: JSCallbackPump) {
        self.value = value
        self.pump = pump
    }

    /// Calls it with plain values (strings, numbers, `NSNull`, arrays and dictionaries of them).
    func call(_ arguments: [any Sendable]) {
        let box = SendableBox(arguments)
        pump.post(value) { _ in box.value }
    }

    /// Calls it with arguments made on the JS thread.
    func call(building arguments: @escaping JSCallbackPump.Arguments) {
        pump.post(value, arguments)
    }
}

/// A value handed across threads whose type is not `Sendable` but is used by one thread at a time.
final class SendableBox<Value>: @unchecked Sendable {
    let value: Value
    init(_ value: Value) { self.value = value }
}

/// `UserDefaults` under a prefix of its own.
enum NativeKeyValue {
    private static let prefix = "hazel.kv."

    static func object(in context: JSContext) -> JSValue {
        let get: @convention(block) (String) -> Any = { key in
            UserDefaults.standard.string(forKey: prefix + key) ?? NSNull()
        }
        let set: @convention(block) (String, String) -> Void = { key, value in
            UserDefaults.standard.set(value, forKey: prefix + key)
        }
        let remove: @convention(block) (String) -> Void = { key in
            UserDefaults.standard.removeObject(forKey: prefix + key)
        }
        let object = JSValue(newObjectIn: context)!
        object.setObject(get, forKeyedSubscript: "get" as NSString)
        object.setObject(set, forKeyedSubscript: "set" as NSString)
        object.setObject(remove, forKeyedSubscript: "remove" as NSString)
        return object
    }
}

/// Bytes across the bridge as typed arrays, with JavaScriptCore's C API: no base64, one copy each way.
enum JSBytes {
    /// The bytes of a `Uint8Array` (any typed array view) or `ArrayBuffer`; `nil` for anything else.
    static func data(_ value: JSValue) -> Data? {
        guard let context = value.context else { return nil }
        let ctx = context.jsGlobalContextRef
        let ref = value.jsValueRef
        var exception: JSValueRef?
        let type = JSValueGetTypedArrayType(ctx, ref, &exception)
        guard type != kJSTypedArrayTypeNone, let object = JSValueToObject(ctx, ref, &exception) else { return nil }
        if type == kJSTypedArrayTypeArrayBuffer {
            let length = JSObjectGetArrayBufferByteLength(ctx, object, &exception)
            guard length > 0, let base = JSObjectGetArrayBufferBytesPtr(ctx, object, &exception) else { return Data() }
            return Data(bytes: base, count: length)
        }
        // A view: its buffer's base, plus the view's offset.
        let length = JSObjectGetTypedArrayByteLength(ctx, object, &exception)
        let offset = JSObjectGetTypedArrayByteOffset(ctx, object, &exception)
        guard length > 0, let buffer = JSObjectGetTypedArrayBuffer(ctx, object, &exception),
              let base = JSObjectGetArrayBufferBytesPtr(ctx, buffer, &exception)
        else { return Data() }
        return Data(bytes: base.advanced(by: offset), count: length)
    }

    /// A `Uint8Array` holding a copy of `data`, freed when JS lets go of it.
    static func uint8Array(_ data: Data, in context: JSContext) -> JSValue {
        let ctx = context.jsGlobalContextRef
        var exception: JSValueRef?
        let bytes = copy(data)
        let object = JSObjectMakeTypedArrayWithBytesNoCopy(
            ctx, kJSTypedArrayTypeUint8Array, bytes, data.count, { bytes, _ in free(bytes) }, nil, &exception
        )
        return JSValue(jsValueRef: object, in: context)
    }

    /// An `ArrayBuffer` holding a copy of `data` (a binary socket frame, as a browser hands it over).
    static func arrayBuffer(_ data: Data, in context: JSContext) -> JSValue {
        let ctx = context.jsGlobalContextRef
        var exception: JSValueRef?
        let bytes = copy(data)
        let object = JSObjectMakeArrayBufferWithBytesNoCopy(
            ctx, bytes, data.count, { bytes, _ in free(bytes) }, nil, &exception
        )
        return JSValue(jsValueRef: object, in: context)
    }

    private static func copy(_ data: Data) -> UnsafeMutableRawPointer {
        let bytes = malloc(max(data.count, 1))!
        data.withUnsafeBytes { source in
            if let base = source.baseAddress { bytes.copyMemory(from: base, byteCount: data.count) }
        }
        return bytes
    }
}

/// A JS event object: `{ type, ...fields }`, made on the JS thread.
func jsEvent(_ type: String, in context: JSContext, _ fields: [String: Any] = [:]) -> JSValue {
    let event = JSValue(newObjectIn: context)!
    event.setObject(type, forKeyedSubscript: "type" as NSString)
    for (key, value) in fields { event.setObject(value, forKeyedSubscript: key as NSString) }
    return event
}
