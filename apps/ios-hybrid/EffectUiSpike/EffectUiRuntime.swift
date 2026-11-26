import Foundation
import JavaScriptCore
import os

/// Runs the `hazel` script (`effect-ui/entry.ts`) in a bare JavaScriptCore context: no WebKit, no
/// DOM. It gives the script timers, `console` and `__native.post`, and hands each batch of ops to
/// the tree.
@MainActor
final class EffectUiRuntime {
    static let log = Logger(subsystem: "sh.hazel.effect-ui-spike", category: "runtime")

    let tree = EffectUiTree()
    private let context = JSContext()!
    private var timers: [Int: DispatchWorkItem] = [:]
    private var nextTimer = 1

    init() {
        context.exceptionHandler = { _, exception in
            Self.log.error("[js] \(exception?.toString() ?? "?", privacy: .public)")
        }
        installConsole()
        installTimers()
        let post: @convention(block) (String) -> Void = { [weak self] json in
            MainActor.assumeIsolated { self?.receive(json) }
        }
        let native = JSValue(newObjectIn: context)!
        native.setObject(post, forKeyedSubscript: "post" as NSString)
        // G5: the demo screen and a debug JS latency, from launch args (`-HazelScreen textField`).
        native.setObject(UserDefaults.standard.string(forKey: "HazelScreen") ?? "", forKeyedSubscript: "screen" as NSString)
        native.setObject(UserDefaults.standard.double(forKey: "HazelLatencyMs"), forKeyedSubscript: "latencyMs" as NSString)
        context.setObject(native, forKeyedSubscript: "__native" as NSString)
        // G3: the data layer's platform services (`Platform/`), on the JS thread's queue.
        HazelPlatform.install(in: context)
    }

    func start() {
        guard let url = Bundle.main.url(forResource: "effect-ui", withExtension: "js", subdirectory: "effect-ui"),
              let script = try? String(contentsOf: url, encoding: .utf8)
        else {
            Self.log.error("[shell] effect-ui.js missing from the bundle")
            return
        }
        let started = ContinuousClock.now
        context.evaluateScript(script, withSourceURL: url)
        Self.log.log("[shell] script ran in \(ContinuousClock.now - started, privacy: .public)")
    }

    /// An event on node `id` (`press`, or an extension's own), back to the native host's `fire`.
    func fire(_ id: Int, _ event: String = "press", payload: String = "{}") {
        let fire = context.objectForKeyedSubscript("__hazel")?.objectForKeyedSubscript("fire")
        _ = fire?.call(withArguments: [id, event, payload])
    }

    private func receive(_ json: String) {
        guard let data = json.data(using: .utf8) else { return }
        do {
            let batch = try JSONDecoder().decode(Batch.self, from: data)
            // A wire this build does not speak is refused, not guessed at.
            guard batch.v == Wire.version else {
                Self.log.error("[shell] refused wire v\(batch.v), this build speaks v\(Wire.version)")
                return
            }
            tree.apply(batch, bytes: data.count)
        } catch {
            Self.log.error("[shell] undecodable batch: \(error, privacy: .public)")
        }
    }

    private func installConsole() {
        let log: @convention(block) () -> Void = {
            let args = JSContext.currentArguments() as? [JSValue] ?? []
            Self.log.log("[js] \(args.map { $0.toString() ?? "" }.joined(separator: " "), privacy: .public)")
        }
        let console = JSValue(newObjectIn: context)!
        for name in ["log", "info", "warn", "error", "debug"] {
            console.setObject(log, forKeyedSubscript: name as NSString)
        }
        context.setObject(console, forKeyedSubscript: "console" as NSString)
    }

    private func installTimers() {
        let schedule: @convention(block) (JSValue, Double) -> Int = { [weak self] callback, ms in
            MainActor.assumeIsolated { self?.schedule(callback, after: ms) ?? 0 }
        }
        let cancel: @convention(block) (Int) -> Void = { [weak self] id in
            MainActor.assumeIsolated { self?.timers.removeValue(forKey: id)?.cancel() }
        }
        context.setObject(schedule, forKeyedSubscript: "setTimeout" as NSString)
        context.setObject(cancel, forKeyedSubscript: "clearTimeout" as NSString)
    }

    private func schedule(_ callback: JSValue, after ms: Double) -> Int {
        let id = nextTimer
        nextTimer += 1
        let box = Box(callback)
        let item = DispatchWorkItem { [weak self] in
            MainActor.assumeIsolated {
                self?.timers[id] = nil
                _ = box.value.call(withArguments: [])
            }
        }
        timers[id] = item
        DispatchQueue.main.asyncAfter(deadline: .now() + max(ms, 0) / 1000, execute: item)
        return id
    }
}

/// A JS value carried into a main-queue work item (it only runs there).
private final class Box: @unchecked Sendable {
    let value: JSValue
    init(_ value: JSValue) { self.value = value }
}
