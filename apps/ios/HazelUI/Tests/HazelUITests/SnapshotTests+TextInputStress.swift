import SwiftUI
import UIKit
import XCTest
@testable import HazelUI

// Lane S2's text-input stress test, in `SnapshotTests` so `verify:S2` runs it. The real `HzTextField`
// in a window, typed into through its `UITextField`, against G5's demo Model (`TextFieldDemo.ts`,
// ported below); events and echoes cross two in-order channels with random delays, as in
// `packages/ui/src/native/textField.test.ts`.

/// The Model side of `vocabulary/TextField.ts` and `demo/TextFieldDemo.ts`.
private struct DemoModel {
    var text = "", rev = 0, edit = 0
    var sent: [String] = []

    var value: JSONValue { ["text": .string(text), "rev": .number(Double(rev)), "edit": .number(Double(edit))] }

    static func tagsUpper(_ text: String) -> String {
        let regex = try! NSRegularExpression(pattern: "#\\w+")
        var out = text
        for match in regex.matches(in: text, range: NSRange(text.startIndex..., in: text)).reversed() {
            let range = Range(match.range, in: out)!
            out.replaceSubrange(range, with: out[range].uppercased())
        }
        return out
    }

    private mutating func changed(_ value: String, _ rev: Int, _ edit: Int) {
        if edit == self.edit { (text, self.rev) = (value, rev) }
    }

    private mutating func set(_ next: String) {
        if next != text { (text, edit) = (next, edit + 1) }
    }

    mutating func update(_ event: String, _ payload: JSONValue) {
        guard let o = payload.object, let value = o["value"]?.string, let rev = o["rev"]?.number,
              let edit = o["edit"]?.number else { return }
        let (r, e) = (Int(rev), Int(edit))
        if event == "change" {
            changed(value, r, e)
            set(Self.tagsUpper(text))
        } else if event == "submit" {
            guard e == self.edit else { return }
            let line = value.replacingOccurrences(of: "\\s+$", with: "", options: .regularExpression)
            guard !line.trimmingCharacters(in: .whitespaces).isEmpty else { return }
            changed(value, r, e)
            set("")
            sent.append(line)
        }
    }
}

/// Delivers in send order, each held for a random delay up to `maxMs` (a bridge never reorders).
@MainActor
private final class Channel<A> {
    private var queue: [(value: A, at: ContinuousClock.Instant)] = []
    private var draining = false
    private let random: () -> Double
    private let maxMs: Double
    private let deliver: (A) -> Void

    init(_ random: @escaping () -> Double, _ maxMs: Double, _ deliver: @escaping (A) -> Void) {
        (self.random, self.maxMs, self.deliver) = (random, maxMs, deliver)
    }

    var idle: Bool { queue.isEmpty }

    func send(_ value: A) {
        queue.append((value, .now + .milliseconds(Int(random() * maxMs))))
        guard !draining else { return }
        draining = true
        Task { @MainActor in
            while let head = self.queue.first {
                if head.at > .now { try? await Task.sleep(until: head.at) }
                self.queue.removeFirst()
                self.deliver(head.value)
            }
            self.draining = false
        }
    }
}

private enum Key { case char(Character), backspace, submit }

extension SnapshotTests {
    private struct Result { let native: String, model: DemoModel, shown: [String] }

    private func runStress(_ keys: [Key], seed: UInt64, latencyMs: Double = 30) async throws -> Result {
        var state = seed
        let random: () -> Double = {
            state = (state &* 1_664_525 &+ 1_013_904_223) % 4_294_967_296
            return Double(state) / 4_294_967_296
        }
        let tree = Tree()
        var model = DemoModel()
        var seq = 1
        try tree.apply(Batch(seq: seq, ops: [
            .create(id: 1, tag: "hz:textField"),
            .props(id: 1, changed: ["label": "Message", "value": model.value]),
            .events(id: 1, names: ["change", "submit"]),
            .insert(parent: 0, id: 1, before: nil),
        ]))
        var lastValue = model.value
        let toNative = Channel<JSONValue>(random, latencyMs) { value in
            seq += 1
            try? tree.apply(Batch(seq: seq, ops: [.props(id: 1, changed: ["value": value])]))
        }
        let toJs = Channel<(String, JSONValue)>(random, latencyMs) { event, payload in
            model.update(event, payload)
            // The host drops repeats of a controlled prop.
            if model.value != lastValue {
                lastValue = model.value
                toNative.send(model.value)
            }
        }
        tree.outbound = { message in
            if case let .fire(_, event, payload, _) = message { toJs.send((event, payload)) }
        }

        let (field, input) = try await host(tree)
        var shown: [String] = []
        let look = { if shown.last != input.text { shown.append(input.text) } }
        for key in keys {
            try await Task.sleep(for: .milliseconds(Int(random() * 3)))
            // What SwiftUI's text binding does with a keystroke (`RevisionedText.binding`'s setter),
            // and what the field's `onSubmit` does.
            switch key {
            case let .char(c): input.type(input.text + String(c))
            case .backspace: input.type(String(input.text.dropLast()))
            case .submit: input.submit()
            }
            look()
        }
        // Settled: both channels empty across a quiet period longer than a render.
        var quiet = 0
        while quiet < 10 {
            try await Task.sleep(for: .milliseconds(10))
            look()
            quiet = toJs.idle && toNative.idle ? quiet + 1 : 0
        }
        // The UIKit field drew what the control holds.
        XCTAssertEqual(field.text ?? "", input.text)
        return Result(native: input.text, model: model, shown: shown)
    }

    /// `TreeView` in a key window: the field's focused `UITextField` and the view's live control.
    private func host(_ tree: Tree) async throws -> (UITextField, RevisionedText) {
        for old in stressWindows { old.isHidden = true }
        stressWindows = []
        let controller = UIHostingController(rootView: TreeView(tree: tree).padding().frame(width: 402))
        let scene = UIApplication.shared.connectedScenes.first as? UIWindowScene
        let window = scene.map { UIWindow(windowScene: $0) } ?? UIWindow()
        window.frame = CGRect(x: 0, y: 0, width: 402, height: 400)
        window.rootViewController = controller
        window.makeKeyAndVisible()
        stressWindows.append(window)
        func find(_ view: UIView) -> UITextField? {
            if let field = view as? UITextField { return field }
            return view.subviews.lazy.compactMap(find).first
        }
        for _ in 0 ..< 100 {
            controller.view.layoutIfNeeded()
            if let field = find(controller.view), let input = RevisionedText.live[1]?.value {
                field.becomeFirstResponder()
                try await Task.sleep(for: .milliseconds(50))
                return (field, input)
            }
            try await Task.sleep(for: .milliseconds(10))
        }
        throw XCTSkip("no UITextField under hz:textField")
    }

    private var runsStress: Bool {
        let lanes = ProcessInfo.processInfo.environment["HAZELUI_LANES"] ?? ""
        return lanes.isEmpty || lanes.split(separator: ",").contains("S2")
    }

    private func chars(_ text: String) -> [Key] { text.map { .char($0) } }

    func testTextInputStressKeepsEveryKeystroke() async throws {
        guard runsStress else { throw XCTSkip("lane S2 only") }
        let typed = "the quick brown fox jumps over the lazy dog, then types some more words fast"
        for seed: UInt64 in [1, 2, 3, 4, 5] {
            let result = try await runStress(chars(typed), seed: seed)
            XCTAssertEqual(result.native, typed, "seed \(seed)")
            XCTAssertEqual(result.model.text, typed, "seed \(seed)")
            for text in result.shown { XCTAssertTrue(typed.hasPrefix(text), "seed \(seed) showed \(text)") }
        }
    }

    func testTextInputStressKeepsDeletions() async throws {
        guard runsStress else { throw XCTSkip("lane S2 only") }
        let keys = chars("hello wrld") + [.backspace, .backspace, .backspace] + chars("orld!")
        let result = try await runStress(keys, seed: 7)
        XCTAssertEqual(result.native, "hello world!")
        XCTAssertEqual(result.model.text, "hello world!")
    }

    func testTextInputStressAppliesModelTransform() async throws {
        guard runsStress else { throw XCTSkip("lane S2 only") }
        let text = "ship #release today and #ops tomorrow"
        for seed: UInt64 in [11, 12, 13] {
            let result = try await runStress(chars(text), seed: seed)
            XCTAssertEqual(result.native, DemoModel.tagsUpper(text), "seed \(seed)")
            XCTAssertEqual(result.model.text, DemoModel.tagsUpper(text), "seed \(seed)")
        }
    }

    func testTextInputStressClearsOnSubmit() async throws {
        guard runsStress else { throw XCTSkip("lane S2 only") }
        for seed: UInt64 in [21, 22, 23] {
            let result = try await runStress(chars("first line  ") + [.submit] + chars("second"), seed: seed)
            XCTAssertEqual(result.model.sent, ["first line"], "seed \(seed)")
            XCTAssertEqual(result.native, "second", "seed \(seed)")
            XCTAssertEqual(result.model.text, "second", "seed \(seed)")
        }
        for seed: UInt64 in [41, 42, 43] {
            let result = try await runStress(chars("once") + [.submit, .submit] + chars("x"), seed: seed)
            XCTAssertEqual(result.model.sent, ["once"], "seed \(seed)")
            XCTAssertEqual(result.native, "x", "seed \(seed)")
        }
        let idle = try await runStress(chars("done") + [.submit], seed: 31)
        XCTAssertEqual(idle.model.sent, ["done"])
        XCTAssertEqual(idle.native, "")
        XCTAssertEqual(idle.model.text, "")
    }

    /// The rule itself, step for step with `revisions.ts`'s cases 1 to 4.
    func testTextRevisionsRuleMatchesRevisionsTs() throws {
        guard runsStress else { throw XCTSkip("lane S2 only") }
        var field = TextRevisions()
        XCTAssertEqual(field.edit("h"), .init(value: "h", rev: 1, edit: 0))
        XCTAssertEqual(field.edit("he"), .init(value: "he", rev: 2, edit: 0))
        XCTAssertNil(field.edit("he"))
        // 1. Stale: an echo of an older revision is ignored.
        XCTAssertNil(field.receive(.init(text: "h", rev: 1, edit: 0)))
        XCTAssertEqual(field.text, "he")
        // 2. The Model has every edit: applied.
        XCTAssertNil(field.receive(.init(text: "he", rev: 2, edit: 0)))
        // 4. A Model edit against rev 2 while the user typed on: appended keystrokes are kept.
        _ = field.edit("hel")
        _ = field.edit("hell")
        XCTAssertEqual(field.receive(.init(text: "HE", rev: 2, edit: 1)), .init(value: "HEll", rev: 5, edit: 1))
        // 1. An older Model edit is ignored.
        XCTAssertNil(field.receive(.init(text: "x", rev: 9, edit: 0)))
        // 3. A newer Model edit that has every local edit: applied.
        XCTAssertNil(field.receive(.init(text: "", rev: 5, edit: 2)))
        XCTAssertEqual(field.current, .init(value: "", rev: 5, edit: 2))
        // 4. Not only appended: the local text wins and is sent as is.
        _ = field.edit("abc")
        _ = field.edit("ab")
        _ = field.edit("abX")
        XCTAssertEqual(field.receive(.init(text: "ABC", rev: 6, edit: 3)), .init(value: "abX", rev: 9, edit: 3))
    }
}

@MainActor private var stressWindows: [UIWindow] = []
