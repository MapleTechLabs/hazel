import Foundation
import Testing
@testable import HazelUI

/// A golden: batches applied in order, each with the tree expected after it.
private struct Golden: Decodable {
    struct Step: Decodable {
        let batch: AnyJSON
        let expect: [String]?
        let count: Int?
        let detached: [Int]?
        let freed: [Int]?
    }
    let steps: [Step]
}

/// Keeps a batch as its raw JSON, so the decoder under test reads the same bytes as the file.
private struct AnyJSON: Decodable {
    let data: Data
    init(from decoder: Decoder) throws {
        let value = try decoder.singleValueContainer().decode(Raw.self)
        data = try JSONSerialization.data(withJSONObject: value.any)
    }
}

private struct Raw: Decodable {
    let any: Any
    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { any = NSNull() }
        else if let b = try? c.decode(Bool.self) { any = b }
        else if let i = try? c.decode(Int.self) { any = i }
        else if let d = try? c.decode(Double.self) { any = d }
        else if let s = try? c.decode(String.self) { any = s }
        else if let a = try? c.decode([Raw].self) { any = a.map(\.any) }
        else { any = try c.decode([String: Raw].self).mapValues(\.any) }
    }
}

@MainActor
struct GoldenTests {
    @Test(arguments: ["mount", "prop-change", "keyed-reorder", "removal", "detach-reattach"])
    func golden(_ name: String) throws {
        let url = try #require(Bundle.module.url(forResource: name, withExtension: "json", subdirectory: "Goldens"))
        let golden = try JSONDecoder().decode(Golden.self, from: Data(contentsOf: url))
        let tree = Tree()
        for (index, step) in golden.steps.enumerated() {
            try tree.apply(WireDecoder.decode(step.batch.data))
            if let expect = step.expect {
                #expect(tree.outline() == expect.joined(separator: "\n"), "\(name) step \(index)")
            }
            if let count = step.count { #expect(tree.count == count, "\(name) step \(index) count") }
            if let detached = step.detached { #expect(tree.detached == Set(detached), "\(name) step \(index)") }
            for id in step.freed ?? [] { #expect(tree.node(id) == nil, "\(name) step \(index): \(id) not freed") }
        }
    }

    @Test func rejectsUnknownVersion() {
        let data = Data(#"{"v": 3, "seq": 1, "ops": []}"#.utf8)
        #expect(throws: WireError.unsupportedVersion(3)) { try WireDecoder.decode(data) }
    }

    @Test func rejectsUnknownOp() {
        let data = Data(#"{"v": 2, "seq": 1, "ops": [["element", 1, "div"]]}"#.utf8)
        #expect(throws: WireError.unknownOp("element")) { try WireDecoder.decode(data) }
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
