import Foundation
import JavaScriptCore
import Observation
import QuartzCore

/// Joins a `JSEngine` to a `Tree`: batches decoded on the JS thread are applied on the main actor, and
/// the tree's `fire` and `reply` messages go back to `__hazel.receive(json)` on the JS thread.
@Observable
@MainActor
public final class TreeHost {
    @ObservationIgnored public let tree = Tree()
    @ObservationIgnored public let engine: JSEngine

    /// What the last batch cost (observed: a stats line can show it).
    public private(set) var batches = 0
    public private(set) var lastOps = 0
    public private(set) var lastBytes = 0
    public private(set) var lastApplyMs = 0.0
    /// The last batch the tree refused (out of order, unknown node), if any.
    public private(set) var lastError: String?

    /// After each applied batch, with its trace and when applying began and ended (`CACurrentMediaTime`).
    @ObservationIgnored public var onApplied: ((Batch, BatchTrace, CFTimeInterval, CFTimeInterval) -> Void)?

    public init(engine: JSEngine) {
        self.engine = engine
        engine.onBatch = { [weak self] batch, trace in
            DispatchQueue.main.async {
                MainActor.assumeIsolated { self?.apply(batch, trace) }
            }
        }
        tree.outbound = { [weak self] message in
            let kind = switch message {
            case let .fire(_, event, _, _): event
            case .reply: "reply"
            }
            self?.send(message, kind: kind)
        }
    }

    /// Sends one message to JS as a JS turn traced as `kind` (`press` for a press, as G4 counts it).
    public func send(_ message: Inbound, kind: String) {
        let json = String(decoding: WireEncoder.encode(message), as: UTF8.self)
        engine.perform(kind) { engine in TreeHost.deliver(message, json: json, engine: engine) }
    }

    /// `__hazel.receive(json)`; a bundle from before it (`__hazel.fire(id, event, payloadJson)`) still
    /// gets its events, and its replies are dropped with a log line.
    nonisolated private static func deliver(_ message: Inbound, json: String, engine: JSEngine) {
        if hasReceive(engine) {
            engine.call("receive", with: [json])
            return
        }
        switch message {
        case let .fire(id, event, payload, _):
            let data = try? JSONSerialization.data(withJSONObject: WireEncoder.any(payload), options: [.fragmentsAllowed])
            engine.call("fire", with: [id, event, String(decoding: data ?? Data("{}".utf8), as: UTF8.self)])
        case let .reply(request, _, _):
            JSEngine.log.error("[shell] reply \(request) dropped: the bundle has no __hazel.receive")
        }
    }

    nonisolated private static func hasReceive(_ engine: JSEngine) -> Bool {
        engine.evaluate("typeof __hazel === 'object' && typeof __hazel.receive === 'function'", url: nil)?.toBool() ?? false
    }

    private func apply(_ batch: Batch, _ trace: BatchTrace) {
        let started = CACurrentMediaTime()
        do {
            try tree.apply(batch)
            lastError = nil
        } catch {
            lastError = "\(error)"
            JSEngine.log.error("[tree] batch \(batch.seq) refused: \(error, privacy: .public)")
        }
        let done = CACurrentMediaTime()
        batches += 1
        lastOps = batch.ops.count
        lastBytes = trace.bytes
        lastApplyMs = (done - started) * 1000
        onApplied?(batch, trace, started, done)
    }
}
