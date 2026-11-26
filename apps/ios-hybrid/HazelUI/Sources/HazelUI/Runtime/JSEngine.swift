import Foundation
import JavaScriptCore
import QuartzCore
import os

/// Where a batch came from and what it cost on the JS thread, for the G4 numbers. Times are
/// `CACurrentMediaTime`, which every thread shares.
public struct BatchTrace: Sendable {
    /// What started the JS turn: `mount`, `press`, `timer`, `message`, `burst`, ...
    public let kind: String
    public let origin: CFTimeInterval
    public let posted: CFTimeInterval
    public let decoded: CFTimeInterval
    public let bytes: Int
}

/// The JavaScriptCore context and everything that touches it, confined to one `JSThread`. Every
/// method except `perform` runs on that thread; the main actor reaches it only through `perform`.
public final class JSEngine: @unchecked Sendable {
    public static let log = Logger(subsystem: "sh.hazel.ui", category: "runtime")
    public let thread = JSThread()
    private var context: JSContext?
    private var timers: [Int: CFRunLoopTimer] = [:]
    private var nextTimer = 1
    /// The cause of the JS turn running now; a `setTimeout(0)` inherits it.
    private var origin = (kind: "idle", at: CFTimeInterval(0))
    public private(set) var hostTimers = 0

    /// Runs on the JS thread with each decoded batch; hops to the main actor itself.
    public var onBatch: (@Sendable (Batch, BatchTrace) -> Void)?

    public init() { thread.launch() }

    /// Queues `body` as a JS turn whose batches are traced as `kind` from `origin` (default: now, on
    /// the caller's thread, so the hop to JS counts).
    public func perform(_ kind: String, origin: CFTimeInterval? = nil, _ body: @escaping @Sendable (JSEngine) -> Void) {
        let at = origin ?? CACurrentMediaTime()
        thread.perform { [self] in
            self.origin = (kind, at)
            body(self)
        }
    }

    /// Creates the context, installs the runtime baseline, then runs `ready` hooks (platform services).
    public func boot(ready: [@Sendable (JSContext) -> Void]) {
        let context = JSContext()!
        self.context = context
        context.name = "hazel"
        context.exceptionHandler = { _, exception in
            JSEngine.log.error("[js] \(exception?.toString() ?? "?", privacy: .public)")
        }
        installConsole(context)
        installTimers(context)
        let now: @convention(block) () -> Double = { CACurrentMediaTime() * 1000 }
        let performance = JSValue(newObjectIn: context)!
        performance.setObject(now, forKeyedSubscript: "now" as NSString)
        context.setObject(performance, forKeyedSubscript: "performance" as NSString)
        // The batch arrives as a JS string and is read as UTF-8 bytes (C2), never as a Swift `String`.
        let post: @convention(block) (JSValue) -> Void = { [unowned self] json in self.receive(WireBytes.utf8(json)) }
        let native = JSValue(newObjectIn: context)!
        native.setObject(post, forKeyedSubscript: "post" as NSString)
        context.setObject(native, forKeyedSubscript: "__native" as NSString)
        for hook in ready { hook(context) }
    }

    @discardableResult
    public func evaluate(_ script: String, url: URL?) -> JSValue? {
        context?.evaluateScript(script, withSourceURL: url)
    }

    /// Calls `__hazel.<path>(...args)`.
    @discardableResult
    public func call(_ path: String..., with args: [Any] = []) -> JSValue? {
        var target = context?.objectForKeyedSubscript("__hazel")
        for key in path { target = target?.objectForKeyedSubscript(key) }
        return target?.call(withArguments: args)
    }

    // Decoding stays here, off the main actor: it is most of a batch's native cost (G8).
    private func receive(_ data: Data) {
        let posted = CACurrentMediaTime()
        do {
            let batch = try WireDecoder.decode(data)
            let trace = BatchTrace(
                kind: origin.kind, origin: origin.at, posted: posted, decoded: CACurrentMediaTime(),
                bytes: data.count
            )
            onBatch?(batch, trace)
        } catch let WireError.unsupportedVersion(version) {
            JSEngine.log.error("[shell] refused wire v\(version), this build speaks v\(WIRE_VERSION)")
        } catch {
            JSEngine.log.error("[shell] undecodable batch: \(error, privacy: .public)")
        }
    }

    private func installConsole(_ context: JSContext) {
        let log: @convention(block) () -> Void = {
            let args = JSContext.currentArguments() as? [JSValue] ?? []
            JSEngine.log.log("[js] \(args.map { $0.toString() ?? "" }.joined(separator: " "), privacy: .public)")
        }
        let console = JSValue(newObjectIn: context)!
        for name in ["log", "info", "warn", "error", "debug"] {
            console.setObject(log, forKeyedSubscript: name as NSString)
        }
        context.setObject(console, forKeyedSubscript: "console" as NSString)
    }

    private func installTimers(_ context: JSContext) {
        let once: @convention(block) (JSValue, Double) -> Int = { [unowned self] callback, ms in
            self.schedule(callback, ms: ms, repeats: false)
        }
        let every: @convention(block) (JSValue, Double) -> Int = { [unowned self] callback, ms in
            self.schedule(callback, ms: ms, repeats: true)
        }
        let cancel: @convention(block) (Int) -> Void = { [unowned self] id in
            if let timer = self.timers.removeValue(forKey: id) { CFRunLoopTimerInvalidate(timer) }
        }
        context.setObject(once, forKeyedSubscript: "setTimeout" as NSString)
        context.setObject(every, forKeyedSubscript: "setInterval" as NSString)
        context.setObject(cancel, forKeyedSubscript: "clearTimeout" as NSString)
        context.setObject(cancel, forKeyedSubscript: "clearInterval" as NSString)
    }

    private func schedule(_ callback: JSValue, ms: Double, repeats: Bool) -> Int {
        let id = nextTimer
        nextTimer += 1
        let delay = max(ms, 0) / 1000
        // A zero-delay hop continues the turn that asked for it, so its batches keep that cause.
        let inherited = delay == 0 ? origin : nil
        if delay == 0 { hostTimers += 1 }
        let timer = thread.timer(after: delay, interval: repeats ? max(delay, 0.001) : 0) { [unowned self] in
            if !repeats { self.timers[id] = nil }
            self.origin = inherited ?? ("timer", CACurrentMediaTime())
            callback.call(withArguments: [])
        }
        timers[id] = timer
        return id
    }
}
