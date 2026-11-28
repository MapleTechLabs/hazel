import Foundation
import SwiftUI
import Testing
@testable import HazelUI

// Lane S0: the Swift side of commands, replies, events, detached subtrees and the extension registry.
// In `GoldenTests`' suite so `verify:S0` (`-only-testing:HazelUITests/GoldenTests`) runs them.

private let goldenDirectory = URL(filePath: #filePath)
    .deletingLastPathComponent()
    .appending(path: "../../../../../packages/ui/src/native/__goldens__")
    .standardized

private func loadGolden(_ name: String) throws -> [String: Any] {
    let data = try Data(contentsOf: goldenDirectory.appending(path: name))
    return try #require(try JSONSerialization.jsonObject(with: data) as? [String: Any])
}

private func batchData(_ raw: Any) throws -> Data { try JSONSerialization.data(withJSONObject: raw) }

/// Waits (briefly) for `count` messages: command handlers run on their own main-actor task.
@MainActor
private func collect(_ sent: () -> [Inbound], _ count: Int) async -> [Inbound] {
    for _ in 0 ..< 200 where sent().count < count { try? await Task.sleep(for: .milliseconds(5)) }
    return sent()
}

@MainActor
final class Outbox {
    var messages: [Inbound] = []
    func attach(_ tree: Tree) { tree.outbound = { [unowned self] in self.messages.append($0) } }
}

extension GoldenTests {
    /// `commands.json`: handlers answer focus, scrollTo, measure and a failed select with exactly the
    /// golden's replies, and each reply decodes in TypeScript's shape.
    @Test func commandsGoldenReplies() async throws {
        let file = try loadGolden("commands.json")
        let steps = try #require(file["steps"] as? [[String: Any]])
        let tree = Tree()
        let outbox = Outbox()
        outbox.attach(tree)
        try tree.apply(WireDecoder.decode(batchData(steps[0]["batch"]!)))
        tree.setCommandHandler(1) { name, args in
            switch name {
            case .focus: return nil
            case .measure: return ["x": 16, "y": 120.5, "width": 370, "height": 44]
            case .select: throw CommandError("no text to select")
            default: throw CommandError("unexpected \(name)")
            }
        }
        tree.setCommandHandler(2) { name, args in
            #expect(name == .scrollTo && args == ["key": "m42"])
            return nil
        }
        try tree.apply(WireDecoder.decode(batchData(steps[1]["batch"]!)))
        let replies = await collect({ outbox.messages }, 4)
        let expected = (file["inbound"] as? [[String: Any]] ?? []).compactMap { $0["decoded"] as? String }
        #expect(replies.map(WireText.describe).sorted() == expected.sorted())
        for reply in replies {
            #expect(try WireDecoder.decodeInbound(WireEncoder.encode(reply)) == reply)
        }
    }

    /// A command that arrives before its view registers waits for it; one with no handler fails once.
    @Test func commandsWaitThenTimeOut() async throws {
        let tree = Tree()
        tree.commandTimeout = .milliseconds(50)
        let outbox = Outbox()
        outbox.attach(tree)
        try tree.apply(Batch(seq: 1, ops: [
            .create(id: 1, tag: "hz:textField"), .insert(parent: 0, id: 1, before: nil),
            .command(request: 7, id: 1, name: .focus, args: .null),
        ]))
        #expect(outbox.messages.isEmpty)
        let token = tree.setCommandHandler(1) { _, _ in true }
        #expect(await collect({ outbox.messages }, 1) == [.reply(request: 7, ok: true, result: true)])
        tree.removeCommandHandler(1, token: token)

        try tree.apply(Batch(seq: 2, ops: [.command(request: 8, id: 1, name: .blur, args: .null)]))
        try await Task.sleep(for: .milliseconds(150))
        #expect(outbox.messages.count == 2)
        #expect(outbox.messages.last == .reply(request: 8, ok: false, result: "hz:textField does not handle blur"))
    }

    /// Removing a node fails its waiting commands at once, and frees its handler.
    @Test func removalFailsWaitingCommands() throws {
        let tree = Tree()
        let outbox = Outbox()
        outbox.attach(tree)
        try tree.apply(Batch(seq: 1, ops: [
            .create(id: 1, tag: "hz:list"), .insert(parent: 0, id: 1, before: nil),
            .command(request: 1, id: 1, name: .scrollTo, args: ["key": "a"]),
        ]))
        try tree.apply(Batch(seq: 2, ops: [.remove(id: 1)]))
        #expect(outbox.messages == [.reply(request: 1, ok: false, result: "node 1 was removed")])
        #expect(tree.count == 1)
    }

    /// `fire` carries the last applied seq and reports whether the node or an ancestor handles it.
    @Test func fireCarriesSeqAndBubbles() throws {
        let tree = Tree()
        let outbox = Outbox()
        outbox.attach(tree)
        try tree.apply(Batch(seq: 1, ops: [
            .create(id: 1, tag: "hz:item"), .events(id: 1, names: ["press"]),
            .create(id: 2, tag: "hz:icon"), .insert(parent: 1, id: 2, before: nil), .insert(parent: 0, id: 1, before: nil),
        ]))
        #expect(tree.fire(2, "press"))
        #expect(!tree.fire(2, "longPress", ["x": 1]))
        #expect(outbox.messages == [
            .fire(id: 2, event: "press", payload: [:], seq: 1),
            .fire(id: 2, event: "longPress", payload: ["x": 1], seq: 1),
        ])
    }

    /// A detached subtree keeps its nodes (and takes prop changes) until reinserted or removed.
    @Test func detachedSubtreeStaysAlive() throws {
        let tree = Tree()
        try tree.apply(Batch(seq: 1, ops: [
            .create(id: 1, tag: "#container"), .create(id: 2, tag: "hz:text"), .insert(parent: 1, id: 2, before: nil),
            .detach(id: 1),
        ]))
        #expect(tree.detached == [1])
        #expect(tree.count == 3)
        try tree.apply(Batch(seq: 2, ops: [.props(id: 2, changed: ["tone": "muted"]), .insert(parent: 0, id: 1, before: nil)]))
        #expect(tree.detached.isEmpty)
        #expect(tree.root.children == [1])
        try tree.apply(Batch(seq: 3, ops: [.detach(id: 1), .remove(id: 1)]))
        #expect(tree.count == 1 && tree.detached.isEmpty)
    }

    @Test func slotsContentAndText() throws {
        let tree = Tree()
        try tree.apply(Batch(seq: 1, ops: [
            .create(id: 1, tag: "hz:item"),
            .create(id: 2, tag: "hz:slot"), .props(id: 2, changed: ["name": "leading"]), .insert(parent: 1, id: 2, before: nil),
            .create(id: 3, tag: "hz:text"), .create(id: 4, tag: "#text"), .text(id: 4, text: "Hi "),
            .create(id: 5, tag: "#text"), .text(id: 5, text: "there"),
            .insert(parent: 3, id: 4, before: nil), .insert(parent: 3, id: 5, before: nil), .insert(parent: 1, id: 3, before: nil),
        ]))
        let item = try #require(tree.node(1))
        #expect(tree.slot("leading", of: item)?.id == 2)
        #expect(tree.slot("trailing", of: item) == nil)
        #expect(tree.content(of: item).map(\.id) == [3])
        #expect(tree.text(of: try #require(tree.node(3))) == "Hi there")
    }

    /// The registry draws a registered name, decodes typed props, and the manifest check names what is
    /// missing or undeclared.
    @Test func extensionRegistryAndManifest() throws {
        struct Mesh: Decodable { let colors: [String]; let speed: Double }
        HazelExtensions.register("TestMesh", props: Mesh.self) { props, _ in
            EmptyViewMarker(colors: props.colors)
        }
        HazelExtensions.register("TestRaw") { _, _ in EmptyViewMarker(colors: []) }
        defer {
            HazelExtensions.unregister("TestMesh")
            HazelExtensions.unregister("TestRaw")
        }
        #expect(HazelExtensions.view("TestMesh", args: ["colors": ["brand.500"], "speed": 0.4], send: { _, _ in }) != nil)
        #expect(HazelExtensions.view("TestMesh", args: ["colors": 3], send: { _, _ in }) == nil)
        #expect(HazelExtensions.view("Unregistered", args: [:], send: { _, _ in }) == nil)

        let manifest = try ExtensionManifest(json: Data(#"""
        [{"name": "TestMesh", "platforms": ["ios"], "events": ["Tapped"]},
         {"name": "TestChart", "platforms": ["web"]},
         {"name": "TestMap", "platforms": ["ios", "web"]}]
        """#.utf8))
        let report = HazelExtensions.check(manifest)
        #expect(report.missing == ["TestMap"])
        #expect(report.undeclared.contains("TestRaw"))
        #expect(!report.undeclared.contains("TestMesh"))
        #expect(!report.ok)
        HazelExtensions.unregister("TestRaw")
        HazelExtensions.register("TestMap") { _, _ in EmptyViewMarker(colors: []) }
        defer { HazelExtensions.unregister("TestMap") }
        let others = HazelExtensions.registered.subtracting(["TestMesh", "TestMap"])
        #expect(ManifestReport(manifest: manifest, registered: HazelExtensions.registered.subtracting(others), platform: "ios").ok)
    }

    @Test func jsonValueCodableRoundTrip() throws {
        let value: JSONValue = ["a": [1, 2.5, "x", true, nil], "b": ["c": false]]
        #expect(try value.decode(JSONValue.self) == value)
        struct Payload: Encodable { let value: String; let rev: Int }
        #expect(try JSONValue(encoding: Payload(value: "hi", rev: 3)) == ["value": "hi", "rev": 3])
    }
}

private struct EmptyViewMarker: View {
    let colors: [String]
    var body: some View { EmptyView() }
}
