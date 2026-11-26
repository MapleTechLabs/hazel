import SwiftUI
import UIKit
import XCTest
@testable import HazelUI

/// G8: a 500-row tree hosted in a real window, then one row's prop changes.
@MainActor
final class RedrawTests: XCTestCase {
    private var window: UIWindow?

    override func tearDown() async throws {
        window?.isHidden = true
        window = nil
    }

    private func host(_ tree: Tree) async -> UIHostingController<TreeView> {
        let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene
        let window = scene.map { UIWindow(windowScene: $0) } ?? UIWindow()
        window.frame = CGRect(x: 0, y: 0, width: 402, height: 874)
        let controller = UIHostingController(rootView: TreeView(tree: tree))
        window.rootViewController = controller
        window.makeKeyAndVisible()
        self.window = window
        await settle(controller)
        return controller
    }

    /// Lets SwiftUI run its pending graph updates.
    private func settle(_ controller: UIViewController) async {
        for _ in 0..<4 {
            controller.view.setNeedsLayout()
            controller.view.layoutIfNeeded()
            try? await Task.sleep(for: .milliseconds(20))
        }
    }

    private func delta(since before: [NodeId: Int], _ now: [NodeId: Int] = RenderCounter.counts) -> [NodeId: Int] {
        now.reduce(into: [:]) { out, entry in
            let d = entry.value - (before[entry.key] ?? 0)
            if d != 0 { out[entry.key] = d }
        }
    }

    func testOneRowPropChangeRedrawsOnlyThatRow() async throws {
        #if !DEBUG
        throw XCTSkip("render counters exist in debug builds only")
        #endif
        let rows = 500
        RenderCounter.reset()
        let tree = Tree()
        try tree.apply(WireDecoder.decode(Fixture.mount(rows: rows)))
        let controller = await host(tree)

        // Mount: the screen, the section, every row and every row's text drew.
        let mounted = RenderCounter.counts
        let mountedLists = RenderCounter.listCounts
        let rowIds = (0..<rows).map(Fixture.rowId)
        XCTAssertEqual(rowIds.filter { (mounted[$0] ?? 0) >= 1 }.count, rows, "every row drew on mount")
        XCTAssertGreaterThanOrEqual(mounted[1] ?? 0, 1)
        XCTAssertGreaterThanOrEqual(mounted[2] ?? 0, 1)
        print("HAZELUI_G8 mount: \(mounted.count) views drew, \(mounted.values.reduce(0, +)) bodies")

        let target = 250
        try tree.apply(WireDecoder.decode(Fixture.badge(row: target, value: 42, seq: 2)))
        await settle(controller)
        let changed = delta(since: mounted)
        print("HAZELUI_G8 one-prop change on row \(Fixture.rowId(target)): body deltas \(changed)")
        XCTAssertEqual(changed, [Fixture.rowId(target): 1], "only the changed row re-evaluates")
        XCTAssertEqual(delta(since: mountedLists, RenderCounter.listCounts), [:], "no child list re-evaluates")
        XCTAssertEqual(tree.node(Fixture.rowId(target))?[prop: "badge"], .number(42))

        // A text op on a row's child redraws that text view only, not its row.
        let beforeText = RenderCounter.counts
        let beforeTextLists = RenderCounter.listCounts
        let textId = Fixture.rowId(10) + 1
        try tree.apply(WireDecoder.decode(Fixture.batch(seq: 3, ops: [#"["text",\#(textId),"edited"]"#])))
        await settle(controller)
        let textDelta = delta(since: beforeText)
        print("HAZELUI_G8 text change on \(textId): body deltas \(textDelta)")
        XCTAssertEqual(textDelta, [textId: 1])
        XCTAssertEqual(delta(since: beforeTextLists, RenderCounter.listCounts), [:])

        // Inserting a row re-evaluates the section's child list and the new row; the section's own
        // body (its header) and the other 500 rows stay put.
        let beforeInsert = RenderCounter.counts
        let beforeInsertLists = RenderCounter.listCounts
        let newId = 100_000
        try tree.apply(WireDecoder.decode(Fixture.batch(seq: 4, ops: [
            #"["create",\#(newId),"hz:item"]"#, #"["props",\#(newId),{"title":"new"}]"#,
            #"["insert",2,\#(newId),\#(Fixture.rowId(0))]"#,
        ])))
        await settle(controller)
        let insertDelta = delta(since: beforeInsert)
        let insertLists = delta(since: beforeInsertLists, RenderCounter.listCounts)
        print("HAZELUI_G8 insert before first row: body deltas \(insertDelta), child-list deltas \(insertLists)")
        XCTAssertEqual(insertDelta, [newId: 1])
        XCTAssertEqual(insertLists, [2: 1, newId: 1])
    }

    /// Hosted cost of a one-prop change: apply plus SwiftUI's update and layout.
    func testHostedSinglePropUpdateTime() async throws {
        let tree = Tree()
        try tree.apply(WireDecoder.decode(Fixture.mount(rows: 500)))
        let controller = await host(tree)
        let clock = ContinuousClock()
        var samples: [Duration] = []
        for i in 0..<30 {
            let data = Fixture.badge(row: i * 7 % 500, value: 100 + i, seq: 2 + i)
            let started = clock.now
            try tree.apply(WireDecoder.decode(data))
            controller.view.setNeedsLayout()
            controller.view.layoutIfNeeded()
            samples.append(clock.now - started)
            try? await Task.sleep(for: .milliseconds(5))
        }
        print("HAZELUI_TIMING hosted one-prop (decode+apply+layout, 500 rows): \(Timing.summary(samples))")
    }
}
