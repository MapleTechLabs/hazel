import Foundation
import JavaScriptCore
import QuartzCore

/// Where a batch came from and what it cost on the JS thread, for the G4 numbers. Times are
/// `CACurrentMediaTime`, which every thread shares.
struct BatchTrace: Sendable {
    /// What started the JS turn: `mount`, `press`, `timer`, `message`, `burst`, ...
    let kind: String
    let origin: CFTimeInterval
    let posted: CFTimeInterval
    let decoded: CFTimeInterval
    let bytes: Int
}

// Immutable value types decoded on the JS thread and handed to the main actor once.
extension Batch: @unchecked Sendable {}

/// The JavaScriptCore context and everything that touches it, confined to one `JSThread`. Every
/// method except `perform` runs on that thread; the main actor reaches it only through `perform`.
final class JSEngine: @unchecked Sendable {
    let thread = JSThread()
    private var context: JSContext?
    private var timers: [Int: CFRunLoopTimer] = [:]
    private var nextTimer = 1
    /// The cause of the JS turn running now; a `setTimeout(0)` inherits it.
    private var origin = (kind: "idle", at: CFTimeInterval(0))
    private(set) var hostTimers = 0

    /// Runs on the JS thread with each decoded batch; hops to the main actor itself.
    var onBatch: (@Sendable (Batch, BatchTrace) -> Void)?

    init() { thread.launch() }

    /// Queues `body` as a JS turn whose batches are traced as `kind` from `origin` (default: now, on
    /// the caller's thread, so the hop to JS counts).
    func perform(_ kind: String, origin: CFTimeInterval? = nil, _ body: @escaping @Sendable (JSEngine) -> Void) {
        let at = origin ?? CACurrentMediaTime()
        thread.perform { [self] in
            self.origin = (kind, at)
            body(self)
        }
    }

    /// Creates the context, installs the runtime baseline, then runs `ready` hooks (platform services).
    func boot(ready: [@Sendable (JSContext) -> Void]) {
        let context = JSContext()!
        self.context = context
        context.name = "hazel"
        context.exceptionHandler = { _, exception in
            EffectUiRuntime.log.error("[js] \(exception?.toString() ?? "?", privacy: .public)")
        }
        installConsole(context)
        installTimers(context)
        let now: @convention(block) () -> Double = { CACurrentMediaTime() * 1000 }
        let performance = JSValue(newObjectIn: context)!
        performance.setObject(now, forKeyedSubscript: "now" as NSString)
        context.setObject(performance, forKeyedSubscript: "performance" as NSString)
        let post: @convention(block) (String) -> Void = { [unowned self] json in self.receive(json) }
        let native = JSValue(newObjectIn: context)!
        native.setObject(post, forKeyedSubscript: "post" as NSString)
        context.setObject(native, forKeyedSubscript: "__native" as NSString)
        for hook in ready { hook(context) }
    }

    @discardableResult
    func evaluate(_ script: String, url: URL?) -> JSValue? {
        context?.evaluateScript(script, withSourceURL: url)
    }

    /// Calls `__hazel.<path>(...args)`.
    @discardableResult
    func call(_ path: String..., with args: [Any] = []) -> JSValue? {
        var target = context?.objectForKeyedSubscript("__hazel")
        for key in path { target = target?.objectForKeyedSubscript(key) }
        return target?.call(withArguments: args)
    }

    // Decoding stays here, off the main actor: it is most of a batch's native cost (G8).
    private func receive(_ json: String) {
        let posted = CACurrentMediaTime()
        let data = Data(json.utf8)
        do {
            let batch = try JSONDecoder().decode(Batch.self, from: data)
            guard batch.v == Wire.version else {
                EffectUiRuntime.log.error("[shell] refused wire v\(batch.v), this build speaks v\(Wire.version)")
                return
            }
            let trace = BatchTrace(
                kind: origin.kind, origin: origin.at, posted: posted, decoded: CACurrentMediaTime(),
                bytes: data.count
            )
            onBatch?(batch, trace)
        } catch {
            EffectUiRuntime.log.error("[shell] undecodable batch: \(error, privacy: .public)")
        }
    }

    private func installConsole(_ context: JSContext) {
        let log: @convention(block) () -> Void = {
            let args = JSContext.currentArguments() as? [JSValue] ?? []
            EffectUiRuntime.log.log("[js] \(args.map { $0.toString() ?? "" }.joined(separator: " "), privacy: .public)")
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
