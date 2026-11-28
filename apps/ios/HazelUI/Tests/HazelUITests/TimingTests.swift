import Foundation
import XCTest
@testable import HazelUI

enum Timing {
    static func ms(_ d: Duration) -> Double {
        Double(d.components.seconds) * 1000 + Double(d.components.attoseconds) / 1e15
    }

    static func summary(_ samples: [Duration]) -> String {
        let sorted = samples.map(ms).sorted()
        let median = sorted[sorted.count / 2]
        return String(format: "median %.3f ms, min %.3f ms, max %.3f ms (n=%d)", median, sorted.first!, sorted.last!, sorted.count)
    }
}

/// Decode and apply times, headless (no views). Printed as HAZELUI_TIMING lines.
@MainActor
final class TimingTests: XCTestCase {
    private let clock = ContinuousClock()

    private func mountTimes(rows: Int, runs: Int = 10) throws {
        let data = Fixture.mount(rows: rows)
        var decode: [Duration] = [], apply: [Duration] = []
        for _ in 0..<runs {
            let t0 = clock.now
            let batch = try WireDecoder.decode(data)
            let t1 = clock.now
            let tree = Tree()
            try tree.apply(batch)
            let t2 = clock.now
            decode.append(t1 - t0)
            apply.append(t2 - t1)
            XCTAssertEqual(tree.count, 3 + 2 * rows)
        }
        print("HAZELUI_TIMING mount \(rows) rows, \(data.count) bytes, \(7 * rows + 6) ops: decode \(Timing.summary(decode)); apply \(Timing.summary(apply))")
    }

    func testMount500() throws { try mountTimes(rows: 500) }
    func testMount3000() throws { try mountTimes(rows: 3000) }

    func testSinglePropBatch() throws {
        let tree = Tree()
        try tree.apply(WireDecoder.decode(Fixture.mount(rows: 3000)))
        var decode: [Duration] = [], apply: [Duration] = []
        for i in 0..<200 {
            let data = Fixture.badge(row: i * 13 % 3000, value: i, seq: 2 + i)
            let t0 = clock.now
            let batch = try WireDecoder.decode(data)
            let t1 = clock.now
            try tree.apply(batch)
            let t2 = clock.now
            decode.append(t1 - t0)
            apply.append(t2 - t1)
        }
        print("HAZELUI_TIMING one-prop batch on 3000 rows: decode \(Timing.summary(decode)); apply \(Timing.summary(apply))")
    }

    /// Decoding off the main actor: the batch is Sendable, so the JS thread can decode and hop.
    func testDecodeOffMainThenApply() async throws {
        let data = Fixture.mount(rows: 500)
        let batch = try await Task.detached { try WireDecoder.decode(data) }.value
        let tree = Tree()
        try tree.apply(batch)
        XCTAssertEqual(tree.node(Fixture.rowId(499))?[prop: "title"], .string("channel-499"))
    }
}
