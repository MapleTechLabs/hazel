import Foundation
import JavaScriptCore
import QuartzCore
import os

/// Runs the `hazel` script (`effect-ui/entry.ts`) in a bare JavaScriptCore context on its own thread
/// (`JSEngine`, G4): no WebKit, no DOM. Batches are decoded there and applied here; presses hop to the
/// JS thread. The main actor never waits for JS.
@MainActor
final class EffectUiRuntime {
    nonisolated static let log = Logger(subsystem: "sh.hazel.effect-ui-spike", category: "runtime")

    let tree = EffectUiTree()
    let engine = JSEngine()
    private var readyHooks: [@Sendable (JSContext) -> Void] = []
    private var started = false

    /// Per cause, origin-to-applied times in ms, for the bench (`G4Bench`).
    private(set) var samples: [String: [Double]] = [:]

    init() {
        engine.onBatch = { [weak self] batch, trace in
            DispatchQueue.main.async {
                MainActor.assumeIsolated { self?.applied(batch, trace) }
            }
        }
        installSpikeHooks()
    }

    /// G5's demo screen and debug JS latency (launch args `-HazelScreen textField`, `-HazelLatencyMs 30`),
    /// and G3's data-layer platform services, installed on the JS thread before the script runs.
    func installSpikeHooks() {
        let screen = UserDefaults.standard.string(forKey: "HazelScreen") ?? ""
        let latency = UserDefaults.standard.double(forKey: "HazelLatencyMs")
        onContextReady { context in
            let native = context.objectForKeyedSubscript("__native")
            native?.setObject(screen, forKeyedSubscript: "screen" as NSString)
            native?.setObject(latency, forKeyedSubscript: "latencyMs" as NSString)
        }
        let engine = self.engine
        onContextReady { context in
            HazelPlatform.install(in: context, perform: { block in engine.perform("platform") { _ in block() } })
        }
    }

    /// Runs `hook` on the JS thread once the context and its globals exist, before the script. Platform
    /// services install themselves here. Call before `start()`.
    func onContextReady(_ hook: @escaping @Sendable (JSContext) -> Void) {
        precondition(!started, "onContextReady after start")
        readyHooks.append(hook)
    }

    func start() {
        guard !started else { return }
        started = true
        guard let url = Bundle.main.url(forResource: "effect-ui", withExtension: "js", subdirectory: "effect-ui"),
              let script = try? String(contentsOf: url, encoding: .utf8)
        else {
            Self.log.error("[shell] effect-ui.js missing from the bundle")
            return
        }
        let hooks = readyHooks
        let jit = ProcessInfo.processInfo.environment["JSC_useJIT"] ?? "default"
        engine.perform("mount") { engine in
            let began = CACurrentMediaTime()
            engine.boot(ready: hooks)
            engine.evaluate(script, url: url)
            let ms = (CACurrentMediaTime() - began) * 1000
            Self.log.log("[g4] script eval + mount (JS thread) \(String(format: "%.1f", ms), privacy: .public)ms, JSC_useJIT=\(jit, privacy: .public)")
        }
    }

    /// An event on node `id` (`press`, or an extension's own), sent to the JS thread's `fire`.
    func fire(_ id: Int, _ event: String = "press", payload: String = "{}", kind: String = "press") {
        engine.perform(kind) { $0.call("fire", with: [id, event, payload]) }
    }

    func resetSamples() { samples = [:] }

    private func applied(_ batch: Batch, _ trace: BatchTrace) {
        let applyStart = CACurrentMediaTime()
        tree.apply(batch, bytes: trace.bytes)
        let done = CACurrentMediaTime()
        FrameMonitor.shared.noteBridge(done - applyStart)
        let ms = { (from: CFTimeInterval, to: CFTimeInterval) in (to - from) * 1000 }
        let total = ms(trace.origin, done)
        samples[trace.kind, default: []].append(total)
        // Bursts log in aggregate (`G4Bench`); everything else logs per batch.
        guard !trace.kind.hasPrefix("burst") else { return }
        Self.log.log(
            "[g4] \(trace.kind, privacy: .public) total \(String(format: "%.2f", total), privacy: .public)ms: js \(String(format: "%.2f", ms(trace.origin, trace.posted)), privacy: .public), decode \(String(format: "%.2f", ms(trace.posted, trace.decoded)), privacy: .public), hop \(String(format: "%.2f", ms(trace.decoded, applyStart)), privacy: .public), apply \(String(format: "%.2f", ms(applyStart, done)), privacy: .public) | \(batch.ops.count, privacy: .public) ops \(trace.bytes, privacy: .public) B"
        )
    }
}
