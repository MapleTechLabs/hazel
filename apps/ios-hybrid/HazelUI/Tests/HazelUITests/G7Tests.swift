import Foundation
import JavaScriptCore
import UIKit
import XCTest
@testable import HazelUI

/// G7: the message list's costs per windowing option (A: all rows as trees, B: a JS window of trees,
/// C: all rows as compact data), end to end from Effect UI in JavaScriptCore to native entries.
/// Prints `G7_TIMING` lines; run with `TEST_RUNNER_JSC_useJIT=false` for the no-JIT numbers.
@MainActor
final class G7Tests: XCTestCase {
    nonisolated static let script: String = {
        let url = Bundle.module.url(forResource: "g7bench", withExtension: "js", subdirectory: "JS")!
        return try! String(contentsOf: url, encoding: .utf8)
    }()

    struct Applied {
        var applyMs: Double = 0
        var refreshMs: Double = 0
        var dirty: Set<Int>? = nil
    }

    func apply(_ taken: JSBench.Taken, to tree: Tree, source: ListSource) throws -> Applied {
        let clock = ContinuousClock()
        var out = Applied()
        var dirty: Set<Int> = []
        var changed = false
        for batch in taken.batches {
            let t0 = clock.now
            try tree.apply(batch)
            let t1 = clock.now
            if let d = source.refresh() { dirty.formUnion(d); changed = true }
            out.applyMs += JSBench.ms(t1 - t0)
            out.refreshMs += JSBench.ms(clock.now - t1)
        }
        out.dirty = changed ? dirty : nil
        return out
    }

    func line(_ name: String, _ t: JSBench.Taken, _ a: Applied) -> String {
        String(format: "%@: %d ops, %d bytes, js %.1f ms, take %.1f ms, decode %.1f ms, apply %.1f ms, entries %.1f ms",
               name, t.ops, t.bytes, t.jsMs, t.takeMs, t.decodeMs, a.applyMs, a.refreshMs)
    }

    func median(_ xs: [Double]) -> Double { xs.sorted()[xs.count / 2] }

    func run(_ option: JSBench.Option) throws {
        let jit = JSBench.jitDisabled ? "no-JIT" : "JIT"
        let bench = JSBench(script: Self.script)
        let tree = Tree()
        let source = ListSource(tree: tree)
        let mount = bench.start(option, initial: 3000)
        XCTAssertEqual(bench.errors, [])
        let applied = try apply(mount, to: tree, source: source)
        print("G7_TIMING \(option.rawValue) \(jit) " + line("mount", mount, applied) + ", \(tree.count) nodes, \(source.keys.count) entries")

        // Native layout of every entry (off the main thread in the app; summed here).
        let clock = ContinuousClock()
        let t0 = clock.now
        var height: CGFloat = 0
        for entry in source.entries { height += RowRenderer.layout(entry, width: 402).height }
        print(String(format: "G7_TIMING %@ layout %d entries: %.1f ms (%.0f pt)", option.rawValue, source.entries.count, JSBench.ms(clock.now - t0), height))

        var news: [(JSBench.Taken, Applied)] = []
        for _ in 0..<10 {
            let t = bench.fire("bench", #"{"kind":"new"}"#)
            news.append((t, try apply(t, to: tree, source: source)))
        }
        var reacts: [(JSBench.Taken, Applied)] = []
        for i in 0..<10 {
            // Messages near the newest: always rendered, in B's window too.
            let id = String(format: "m%06d", 2990 - i)
            let t = bench.fire("bench", #"{"kind":"react","id":"\#(id)"}"#)
            let a = try apply(t, to: tree, source: source)
            XCTAssertEqual(a.dirty?.count, 1, "a reaction dirties exactly its row")
            reacts.append((t, a))
        }
        for (name, samples) in [("new message", news), ("reaction", reacts)] {
            print(String(format: "G7_TIMING %@ %@ %@ (median of 10): %d ops, %d bytes, js %.2f ms, take %.2f ms, decode %.2f ms, apply %.2f ms, entries %.2f ms",
                         option.rawValue, jit, name, samples[0].0.ops, samples[0].0.bytes,
                         median(samples.map(\.0.jsMs)), median(samples.map(\.0.takeMs)), median(samples.map(\.0.decodeMs)),
                         median(samples.map(\.1.applyMs)), median(samples.map(\.1.refreshMs))))
        }

        if option == .b {
            // B: native scrolled 60 entries up; JS slides its window.
            let t = bench.fire("viewport", #"{"first":60,"last":75}"#)
            let a = try apply(t, to: tree, source: source)
            print("G7_TIMING B \(jit) " + line("window slide (60 entries)", t, a))
        }

        // An older page of 100 messages, on a list mounted one page short.
        let paged = JSBench(script: Self.script)
        let pagedTree = Tree()
        let pagedSource = ListSource(tree: pagedTree)
        _ = try apply(paged.start(option, initial: 2900), to: pagedTree, source: pagedSource)
        let page = paged.fire("reachStart")
        let pa = try apply(page, to: pagedTree, source: pagedSource)
        print("G7_TIMING \(option.rawValue) \(jit) " + line("older page (100)", page, pa))
        XCTAssertEqual(paged.errors, [])
    }

    func testOptionA() throws { try run(.a) }
    func testOptionB() throws { try run(.b) }
    func testOptionC() throws { try run(.c) }
    func testOptionS() throws { try run(.s) }

    /// Option C's rows decode into the same entries as A's subtrees.
    func testOptionsAgreeOnRows() throws {
        var lists: [[ListEntry]] = []
        for option in [JSBench.Option.a, .c, .s] {
            let bench = JSBench(script: Self.script)
            let tree = Tree()
            let source = ListSource(tree: tree)
            _ = try apply(bench.start(option, initial: 3000), to: tree, source: source)
            lists.append(source.entries)
        }
        XCTAssertEqual(lists[0].count, lists[1].count)
        XCTAssertEqual(lists[0], lists[1])
        XCTAssertEqual(lists[1], lists[2])
        let kinds = lists[1].reduce(into: [String: Int]()) { out, e in
            switch e {
            case .date: out["date", default: 0] += 1
            case .unread: out["unread", default: 0] += 1
            case let .message(row): out[row.grouped ? "grouped" : "message", default: 0] += 1
            case .placeholder: out["placeholder", default: 0] += 1
            }
        }
        print("G7 entries: \(kinds)")
        XCTAssertEqual(kinds["unread"], 1)
        XCTAssertGreaterThan(kinds["date"] ?? 0, 1)
        XCTAssertGreaterThan(kinds["grouped"] ?? 0, 1000)
    }
}

/// Where option C's mount decode goes: Foundation's parse, then the bridge into `JSONValue`.
@MainActor
final class G7DecodeTests: XCTestCase {
    func testDecodeBreakdown() throws {
        let context = JSContext()!
        context.evaluateScript(G7Tests.script)
        let bench = context.objectForKeyedSubscript("__bench")!
        bench.objectForKeyedSubscript("start").call(withArguments: ["C", 3000])
        while bench.objectForKeyedSubscript("tick").call(withArguments: []).toInt32() >= 0 {}
        let text = bench.objectForKeyedSubscript("take").call(withArguments: []).toString()!
        let lines = text.split(separator: "\n").dropFirst().map { Data($0.utf8) }
        let clock = ContinuousClock()
        var parse: [Double] = [], full: [Double] = []
        for _ in 0..<5 {
            let t0 = clock.now
            for data in lines { _ = try JSONSerialization.jsonObject(with: data) }
            let t1 = clock.now
            for data in lines { _ = try WireDecoder.decode(data) }
            let t2 = clock.now
            parse.append(JSBench.ms(t1 - t0))
            full.append(JSBench.ms(t2 - t1))
        }
        print(String(format: "G7_DECODE C mount %d bytes: JSONSerialization %.1f ms, WireDecoder %.1f ms (min of 5)",
                     lines.reduce(0) { $0 + $1.count }, parse.min()!, full.min()!))
    }
}

/// What one row costs to lay out and draw at 3x, on one thread.
final class G7RenderTests: XCTestCase {
    func testRowDrawCost() throws {
        let bench = JSBench(script: G7Tests.script)
        let entries: [ListEntry] = try MainActor.assumeIsolated {
            let tree = Tree()
            let source = ListSource(tree: tree)
            for batch in bench.start(.c, initial: 3000).batches { try tree.apply(batch) }
            source.refresh()
            return Array(source.entries.prefix(300))
        }
        let clock = ContinuousClock()
        let t0 = clock.now
        let layouts = entries.map { RowRenderer.layout($0, width: 402) }
        let t1 = clock.now
        var bytes = 0
        for layout in layouts { bytes += RowRenderer.draw(layout, scale: 3).map { $0.bytesPerRow * $0.height } ?? 0 }
        let t2 = clock.now
        print(String(format: "G7_RENDER 300 rows: layout %.3f ms/row, draw %.3f ms/row, %.0f KB/row",
                     JSBench.ms(t1 - t0) / 300, JSBench.ms(t2 - t1) / 300, Double(bytes) / 300 / 1024))
    }
}
