import Foundation
import JavaScriptCore
import Testing
@testable import HazelUI

/// C2: the shared wire goldens (`packages/ui/src/native/__goldens__`, one source), decoded here to the
/// same canonical text `wire.test.ts` checks, and applied to `Tree` with the same outline after each step.
/// The simulator reads them from the checkout, by this file's path.
private let goldens = URL(filePath: #filePath)
    .deletingLastPathComponent()
    .appending(path: "../../../../../packages/ui/src/native/__goldens__")
    .standardized

private func json(_ name: String) throws -> [String: Any] {
    let data = try Data(contentsOf: goldens.appending(path: name))
    return try #require(try JSONSerialization.jsonObject(with: data) as? [String: Any])
}

private func streams() -> [String] {
    let files = (try? FileManager.default.contentsOfDirectory(atPath: goldens.path)) ?? []
    return files.filter { $0.hasSuffix(".json") && $0 != "rejects.json" }.sorted()
}

/// A batch through JavaScriptCore the way the runtime gets one: `JSON.stringify` in JS, then the JS
/// string read as UTF-8 bytes (`WireBytes`).
private func throughJS(_ batch: Any) throws -> Data {
    let source = try JSONSerialization.data(withJSONObject: batch)
    let context = try #require(JSContext())
    context.setObject(String(decoding: source, as: UTF8.self), forKeyedSubscript: "source" as NSString)
    return WireBytes.utf8(context.evaluateScript("JSON.stringify(JSON.parse(source))"))
}

@MainActor
struct GoldenTests {
    @Test func goldensArePresent() {
        #expect(streams().count >= 6, "no goldens at \(goldens.path)")
    }

    @Test(arguments: streams())
    func golden(_ name: String) throws {
        let golden = try json(name)
        let steps = try #require(golden["steps"] as? [[String: Any]])
        let tree = Tree()
        for (index, step) in steps.enumerated() {
            let raw = try #require(step["batch"])
            let batch = try WireDecoder.decode(try throughJS(raw))
            #expect(batch.ops.map(WireText.describe) == step["ops"] as? [String], "\(name) step \(index) ops")
            try tree.apply(batch)
            #expect(tree.outline() == (step["tree"] as? [String])?.joined(separator: "\n"), "\(name) step \(index) tree")
            #expect(tree.count == step["count"] as? Int, "\(name) step \(index) count")
            #expect(tree.detached == Set(step["detached"] as? [Int] ?? []), "\(name) step \(index) detached")
        }
        for entry in golden["inbound"] as? [[String: Any]] ?? [] {
            let message = try #require(entry["message"])
            let data = try JSONSerialization.data(withJSONObject: message)
            let decoded = try WireDecoder.decodeInbound(data)
            #expect(WireText.describe(decoded) == entry["decoded"] as? String, "\(name) inbound")
            // What Swift encodes reads back the same.
            #expect(try WireDecoder.decodeInbound(WireEncoder.encode(decoded)) == decoded, "\(name) inbound round trip")
        }
    }

    @Test func refusesWhatTypeScriptRefuses() throws {
        let rejects = try #require(try json("rejects.json")["rejects"] as? [[String: Any]])
        for reject in rejects {
            let data = try JSONSerialization.data(withJSONObject: try #require(reject["batch"]))
            let expected = reject["error"] as? String
            do {
                _ = try WireDecoder.decode(data)
                Issue.record("accepted a batch the goldens reject (\(expected ?? "?"))")
            } catch let error as WireError {
                let kind = switch error {
                case .malformed: "malformed"
                case .unsupportedVersion: "unsupportedVersion"
                case .unknownOp: "unknownOp"
                }
                #expect(kind == expected)
            }
        }
    }

    @Test func rejectsOutOfOrderBatch() throws {
        let tree = Tree()
        #expect(throws: TreeError.outOfOrder(expected: 1, got: 2)) {
            try tree.apply(Batch(seq: 2, ops: []))
        }
    }

    @Test func decodesBooleansAndNumbersApart() throws {
        let data = Data(#"{"v": 2, "seq": 1, "ops": [["props", 1, {"a": true, "b": 1, "c": 1.5, "d": 0}]]}"#.utf8)
        let batch = try WireDecoder.decode(data)
        #expect(batch.ops == [.props(id: 1, changed: ["a": .bool(true), "b": .number(1), "c": .number(1.5), "d": .number(0)])])
    }
}
