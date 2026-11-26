import Foundation
import JavaScriptCore

/// G7's JS side in a bare JavaScriptCore context on its own queue (`packages/ui/src/bench/entry.ts`):
/// starts the list, fires events, and returns each flush's batches decoded, with where the time went.
/// Bench-only; the real runtime is lane F's. Set `JSC_useJIT=false` in the environment to time no-JIT.
public final class JSBench: @unchecked Sendable {
    public struct Taken: Sendable {
        public var batches: [Batch] = []
        public var ops = 0
        public var bytes = 0
        /// Effect UI rendering and the native host building ops (the call plus its macrotasks).
        public var jsMs: Double = 0
        /// `JSON.stringify` of the batches and the string crossing into Swift.
        public var takeMs: Double = 0
        public var decodeMs: Double = 0
    }

    public enum Option: String, Sendable { case a = "A", b = "B", c = "C", s = "S" }

    public let queue = DispatchQueue(label: "sh.hazel.ui.js", qos: .userInitiated)
    private var context: JSContext!
    public private(set) var errors: [String] = []

    public init(script: String) {
        queue.sync {
            let context = JSContext()!
            context.exceptionHandler = { [weak self] _, exception in
                self?.errors.append(exception?.toString() ?? "?")
            }
            context.evaluateScript(script)
            self.context = context
        }
    }

    /// Read live: an app may `setenv` it after launch, before its first JSContext.
    public static var jitDisabled: Bool { getenv("JSC_useJIT").map { String(cString: $0) } == "false" }

    private var bench: JSValue { context.objectForKeyedSubscript("__bench") }

    /// Runs `body` then every macrotask it queued, and collects the batches. Call on `queue`.
    private func measure(_ body: () -> Void) -> Taken {
        let clock = ContinuousClock()
        var taken = Taken()
        let t0 = clock.now
        body()
        let tick = bench.objectForKeyedSubscript("tick")!
        while tick.call(withArguments: []).toInt32() >= 0 {}
        let t1 = clock.now
        let bytes = Self.utf8(bench.objectForKeyedSubscript("take").call(withArguments: []))
        let t2 = clock.now
        // One batch per line; JSON escapes newlines inside strings, so a raw 0x0A always ends a batch.
        var lines = bytes.split(separator: 0x0A, omittingEmptySubsequences: true)
        if let first = lines.first, let ops = Int(String(decoding: first, as: UTF8.self)) {
            taken.ops = ops
            lines.removeFirst()
        }
        for line in lines {
            taken.bytes += line.count
            if let batch = try? WireDecoder.decode(Data(line)) { taken.batches.append(batch) } else { errors.append("undecodable batch") }
        }
        let t3 = clock.now
        taken.jsMs = Self.ms(t1 - t0)
        taken.takeMs = Self.ms(t2 - t1)
        taken.decodeMs = Self.ms(t3 - t2)
        return taken
    }

    public func start(_ option: Option, initial: Int) -> Taken {
        queue.sync {
            measure { _ = bench.objectForKeyedSubscript("start").call(withArguments: [option.rawValue, initial]) }
        }
    }

    public func fire(_ event: String, _ payload: String = "{}") -> Taken {
        queue.sync {
            measure { _ = bench.objectForKeyedSubscript("fire").call(withArguments: [event, payload]) }
        }
    }

    /// `fire` off the caller's thread; `done` runs on the JS queue.
    public func fireAsync(_ event: String, _ payload: String = "{}", done: @escaping @Sendable (Taken) -> Void) {
        queue.async {
            let taken = self.measure { _ = self.bench.objectForKeyedSubscript("fire").call(withArguments: [event, payload]) }
            done(taken)
        }
    }

    public func startAsync(_ option: Option, initial: Int, done: @escaping @Sendable (Taken) -> Void) {
        queue.async {
            let taken = self.measure { _ = self.bench.objectForKeyedSubscript("start").call(withArguments: [option.rawValue, initial]) }
            done(taken)
        }
    }

    /// A JS string as UTF-8 bytes, straight from JavaScriptCore (no `NSString` / `String` bridging).
    static func utf8(_ value: JSValue?) -> Data {
        guard let value, let ref = JSValueToStringCopy(value.context.jsGlobalContextRef, value.jsValueRef, nil) else { return Data() }
        defer { JSStringRelease(ref) }
        let capacity = JSStringGetMaximumUTF8CStringSize(ref)
        var data = Data(count: capacity)
        let written = data.withUnsafeMutableBytes { buffer in
            JSStringGetUTF8CString(ref, buffer.baseAddress!.assumingMemoryBound(to: CChar.self), capacity)
        }
        data.count = max(0, written - 1)
        return data
    }

    public static func ms(_ d: Duration) -> Double {
        Double(d.components.seconds) * 1000 + Double(d.components.attoseconds) / 1e15
    }
}
