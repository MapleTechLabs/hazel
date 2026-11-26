import Foundation
import JavaScriptCore
import os

/// The data layer's platform services for a JavaScriptCore context (G3, `docs/hazel-ui.md`): installs
/// `__native.{uuid, kv, socket, http, connectivity, config}` (the contract is
/// `packages/client-data/src/platform/jsc/bridge.ts`) and `setInterval` / `clearInterval`.
final class HazelPlatform: @unchecked Sendable {
    static let log = Logger(subsystem: "sh.hazel.effect-ui-spike", category: "platform")

    /// Runs a block on the JS thread. Swift calls JS only through it.
    typealias Perform = @Sendable (@escaping @Sendable () -> Void) -> Void

    let perform: Perform
    let config: PlatformConfig
    let sockets: PlatformSockets
    let http: PlatformHttp
    let connectivity: PlatformConnectivity
    private let intervals: PlatformIntervals

    private init(perform: @escaping Perform, config: PlatformConfig) {
        self.perform = perform
        self.config = config
        sockets = PlatformSockets(perform: perform)
        http = PlatformHttp(perform: perform)
        connectivity = PlatformConnectivity(perform: perform)
        intervals = PlatformIntervals(perform: perform)
    }

    /// Kept for the app's lifetime, as the context is.
    nonisolated(unsafe) private static var installed: [HazelPlatform] = []

    /// Adds the services to `context`'s `__native` (created if missing). `perform` defaults to the main
    /// queue, where the spike's runtime runs JS today.
    static func install(
        in context: JSContext,
        config: PlatformConfig = .fromEnvironment(),
        perform: @escaping Perform = { block in DispatchQueue.main.async(execute: block) }
    ) {
        let platform = HazelPlatform(perform: perform, config: config)
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
        native.setObject(PlatformKeyValue.object(in: context), forKeyedSubscript: "kv" as NSString)
        native.setObject(platform.sockets.object(in: context), forKeyedSubscript: "socket" as NSString)
        native.setObject(platform.http.object(in: context), forKeyedSubscript: "http" as NSString)
        native.setObject(platform.connectivity.object(in: context), forKeyedSubscript: "connectivity" as NSString)
        native.setObject(config.object(in: context), forKeyedSubscript: "config" as NSString)
        platform.intervals.install(in: context)
        log.log("[platform] installed, api \(config.apiUrl, privacy: .public)")
    }
}

/// A JS function Swift calls back later, always through `perform` (onto the JS thread).
final class JSCallback: @unchecked Sendable {
    private let value: JSValue
    private let perform: HazelPlatform.Perform

    init(_ value: JSValue, perform: @escaping HazelPlatform.Perform) {
        self.value = value
        self.perform = perform
    }

    func call(_ arguments: [Any]) {
        let box = ArgumentsBox(arguments)
        perform { [self] in _ = self.value.call(withArguments: box.values) }
    }
}

/// Plain values (strings, numbers, dictionaries) handed to the JS thread.
private final class ArgumentsBox: @unchecked Sendable {
    let values: [Any]
    init(_ values: [Any]) { self.values = values }
}

/// The server this build talks to. For the gate the token is configuration, not a keychain session.
struct PlatformConfig: Sendable {
    let apiUrl: String
    let token: String?

    /// `HAZEL_API_URL` and `HAZEL_TOKEN` from the launch environment; the local fixture backend otherwise.
    static func fromEnvironment() -> PlatformConfig {
        let env = ProcessInfo.processInfo.environment
        return PlatformConfig(
            apiUrl: env["HAZEL_API_URL"] ?? "http://127.0.0.1:4320",
            token: env["HAZEL_TOKEN"] ?? "fixture"
        )
    }

    func object(in context: JSContext) -> JSValue {
        let object = JSValue(newObjectIn: context)!
        object.setObject(apiUrl, forKeyedSubscript: "apiUrl" as NSString)
        object.setObject(token.map { $0 as Any } ?? NSNull(), forKeyedSubscript: "token" as NSString)
        return object
    }
}

/// `UserDefaults` under a prefix of its own.
enum PlatformKeyValue {
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

/// `setInterval` / `clearInterval` (the runtime baseline; the spike's runtime has only timeouts).
final class PlatformIntervals: @unchecked Sendable {
    private let perform: HazelPlatform.Perform
    private let lock = NSLock()
    private var timers: [Int: DispatchSourceTimer] = [:]
    // Apart from `setTimeout`'s ids, which count up from 1.
    private var nextId = 1_000_000

    init(perform: @escaping HazelPlatform.Perform) { self.perform = perform }

    func install(in context: JSContext) {
        guard context.objectForKeyedSubscript("setInterval")?.isUndefined ?? true else { return }
        let set: @convention(block) (JSValue, Double) -> Int = { [weak self] callback, ms in
            self?.start(JSCallback(callback, perform: self!.perform), every: ms) ?? 0
        }
        let clear: @convention(block) (JSValue) -> Void = { [weak self] id in
            guard id.isNumber else { return }
            self?.stop(Int(id.toInt32()))
        }
        context.setObject(set, forKeyedSubscript: "setInterval" as NSString)
        context.setObject(clear, forKeyedSubscript: "clearInterval" as NSString)
    }

    private func start(_ callback: JSCallback, every ms: Double) -> Int {
        let interval = DispatchTimeInterval.milliseconds(max(Int(ms), 1))
        let timer = DispatchSource.makeTimerSource(queue: .global(qos: .utility))
        timer.schedule(deadline: .now() + interval, repeating: interval)
        timer.setEventHandler { callback.call([]) }
        lock.lock()
        let id = nextId
        nextId += 1
        timers[id] = timer
        lock.unlock()
        timer.resume()
        return id
    }

    private func stop(_ id: Int) {
        lock.lock()
        let timer = timers.removeValue(forKey: id)
        lock.unlock()
        timer?.cancel()
    }
}
