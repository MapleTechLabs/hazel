import QuartzCore
import SwiftUI

/// The G4 measurements (`docs/hazel-ui.md`): press round trips, incoming messages, 100-update bursts
/// and the 50 ms JS stall frame test. Runs at launch with `G4_BENCH=1`, or from the debug bar.
@MainActor
enum G4Bench {
    static func autorun(_ runtime: EffectUiRuntime) {
        FrameMonitor.shared.start()
        guard ProcessInfo.processInfo.environment["G4_BENCH"] == "1" else { return }
        Task { await run(runtime) }
    }

    static func run(_ runtime: EffectUiRuntime) async {
        while runtime.tree.root.isEmpty { try? await Task.sleep(for: .milliseconds(20)) }
        try? await Task.sleep(for: .milliseconds(500))
        report(runtime, "mount", runtime.samples["mount"] ?? [])
        runtime.engine.perform("spin") { engine in
            let result = engine.call("debug", "spin", with: [5_000_000])?.toString() ?? "?"
            EffectUiRuntime.log.log("[g4] spin 5M iterations \(result, privacy: .public)")
        }
        try? await Task.sleep(for: .milliseconds(400))
        // Effect's default scheduler hops through setTimeout(0) per yield; this runtime's stays in JS.
        for which in ["mixed", "native", "mixed", "native"] {
            runtime.engine.perform("yields") { engine in
                let before = engine.hostTimers
                engine.call("debug", "yields", with: [1000, which])
                EffectUiRuntime.log.log("[g4] yields on \(which, privacy: .public) queued, host timers before \(before, privacy: .public)")
            }
            try? await Task.sleep(for: .milliseconds(600))
            runtime.engine.perform("yields") { engine in
                EffectUiRuntime.log.log("[g4] host setTimeout(0) total \(engine.hostTimers, privacy: .public)")
            }
        }

        let items = itemIds(runtime.tree.root)
        runtime.resetSamples()
        for i in 0 ..< 20 {
            runtime.fire(items[i % min(items.count, 4)])
            try? await Task.sleep(for: .milliseconds(150))
        }
        report(runtime, "press", runtime.samples["press"] ?? [])

        for _ in 0 ..< 20 {
            runtime.engine.perform("message") { $0.call("debug", "message") }
            try? await Task.sleep(for: .milliseconds(150))
        }
        report(runtime, "message", runtime.samples["message"] ?? [])

        // 100 messages as 100 separate JS turns (frames off a socket), timed from the first.
        for round in 0 ..< 5 {
            let origin = CACurrentMediaTime()
            for _ in 0 ..< 100 {
                runtime.engine.perform("burst\(round)", origin: origin) { $0.call("debug", "message") }
            }
            try? await Task.sleep(for: .milliseconds(1500))
            let samples = runtime.samples["burst\(round)"] ?? []
            EffectUiRuntime.log.log("[g4] burst100 separate turns: \(samples.count, privacy: .public) batches, last applied \(String(format: "%.1f", samples.max() ?? -1), privacy: .public)ms")
        }
        // 100 messages dispatched in one JS turn (coalesced into one flush).
        for round in 0 ..< 5 {
            runtime.engine.perform("burst1x\(round)") { $0.call("debug", "burst", with: [100]) }
            try? await Task.sleep(for: .milliseconds(800))
            let samples = runtime.samples["burst1x\(round)"] ?? []
            EffectUiRuntime.log.log("[g4] burst100 one turn: \(samples.count, privacy: .public) batches, last applied \(String(format: "%.1f", samples.max() ?? -1), privacy: .public)ms")
        }
        runtime.engine.perform("stats") { engine in
            let stats = engine.call("debug", "stats")?.toString() ?? "?"
            EffectUiRuntime.log.log("[g4] scheduler \(stats, privacy: .public), host setTimeout(0) \(engine.hostTimers, privacy: .public)")
        }
        try? await Task.sleep(for: .milliseconds(300))
        await stallTest(runtime, seconds: Double(ProcessInfo.processInfo.environment["G4_STALL_S"] ?? "") ?? 8)
        EffectUiRuntime.log.log("[g4] bench done")
    }

    /// JS busy 50 ms every 100 ms while the main thread draws (and scrolls, if driven); presses during
    /// it measure how long the stall delays a round trip. A main-thread stall afterwards is the control.
    static func stallTest(_ runtime: EffectUiRuntime, seconds: Double) async {
        let items = itemIds(runtime.tree.root)
        runtime.resetSamples()
        EffectUiRuntime.log.log("[g4] JS stall window starts (\(seconds, privacy: .public)s)")
        let stall = Int(ProcessInfo.processInfo.environment["G4_STALL_MS"] ?? "") ?? 50
        FrameMonitor.shared.begin("js-stall-\(stall)ms")
        let until = CACurrentMediaTime() + seconds
        var n = 0
        while CACurrentMediaTime() < until {
            if stall > 0 { runtime.engine.perform("stall") { $0.call("debug", "stall", with: [stall]) } }
            if n % 3 == 1 { runtime.fire(items[n % min(items.count, 4)], kind: "pressDuringStall") }
            n += 1
            try? await Task.sleep(for: .milliseconds(100))
        }
        FrameMonitor.shared.end()
        report(runtime, "pressDuringStall", runtime.samples["pressDuringStall"] ?? [])

        try? await Task.sleep(for: .milliseconds(300))
        FrameMonitor.shared.begin("main-stall-50ms-control")
        for _ in 0 ..< 5 {
            let until = CACurrentMediaTime() + 0.05
            while CACurrentMediaTime() < until {}
            try? await Task.sleep(for: .milliseconds(200))
        }
        FrameMonitor.shared.end()
    }

    static func stallJS(_ runtime: EffectUiRuntime) {
        runtime.engine.perform("stall") { $0.call("debug", "stall", with: [50]) }
    }

    private static func report(_ runtime: EffectUiRuntime, _ kind: String, _ samples: [Double]) {
        guard !samples.isEmpty else { return }
        let sorted = samples.sorted()
        let median = sorted[sorted.count / 2]
        EffectUiRuntime.log.log(
            "[g4] \(kind, privacy: .public) n=\(sorted.count, privacy: .public) median \(String(format: "%.2f", median), privacy: .public)ms min \(String(format: "%.2f", sorted.first!), privacy: .public) max \(String(format: "%.2f", sorted.last!), privacy: .public)"
        )
    }

    private static func itemIds(_ nodes: [HzNode]) -> [Int] {
        nodes.flatMap { ($0.tag == "hz:item" ? [$0.id] : []) + itemIds($0.children) }
    }
}

/// Native buttons for the G4 checks by hand: they never cross the wire.
struct G4DebugBar: View {
    let runtime: EffectUiRuntime

    var body: some View {
        HStack(spacing: 8) {
            Button("Stall JS 50 ms") { G4Bench.stallJS(runtime) }
            Button("Bench") { Task { await G4Bench.run(runtime) } }
        }
        .font(.caption)
        .buttonStyle(.bordered)
        .padding(.bottom, 4)
    }
}
