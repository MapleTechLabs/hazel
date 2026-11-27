import Foundation

/// One drawable conformance case (`packages/ui/src/conformance/schema.ts`, `FixtureCase`): its id, the
/// tag it belongs to, how it is framed, and the wire batch that builds its tree.
public struct ConformanceCase: Identifiable, Sendable {
    public let id: String
    public let tag: String
    /// `sidebar` (240pt column), `inline` (its own size) or `screen` (the full width).
    public let frame: String
    public let batch: Data
    /// The iOS lane this case waits on (`pending.ios`): skipped as not implemented until it draws it.
    public var pending: String? = nil

    /// The iOS lane that owns this case's tag.
    public var lane: String { HazelVocabulary.lanes["hz:\(tag)"] ?? "?" }
}

public enum ConformanceError: Error, Equatable {
    case malformed(String)
}

/// Reads the shared fixtures (`fixtures/<tag>/<name>.json`) and builds each case's tree exactly as
/// `compile.ts` does: the node, its slots in order (each an `hz:slot`), then its children.
public enum ConformanceFixtures {
    /// Every case under `directory`, ordered as the web orders them (by `<tag>/<name>.json`).
    public static func load(from directory: URL) throws -> [ConformanceCase] {
        let tags = try FileManager.default.contentsOfDirectory(atPath: directory.path).filter { !$0.hasPrefix(".") }
        var files: [(tag: String, name: String, url: URL)] = []
        for tag in tags {
            let folder = directory.appending(path: tag)
            let names = (try? FileManager.default.contentsOfDirectory(atPath: folder.path)) ?? []
            for file in names where file.hasSuffix(".json") {
                files.append((tag, String(file.dropLast(5)), folder.appending(path: file)))
            }
        }
        files.sort { "\($0.tag)/\($0.name).json" < "\($1.tag)/\($1.name).json" }
        return try files.flatMap { file in
            let any = try JSONSerialization.jsonObject(with: Data(contentsOf: file.url))
            guard let fixture = any as? [String: Any] else { throw ConformanceError.malformed(file.url.path) }
            return try expand(tag: file.tag, name: file.name, fixture: fixture)
        }
    }

    /// Base case, then each axis value in order, then each named case (`schema.ts` `expand`).
    static func expand(tag: String, name: String, fixture: [String: Any]) throws -> [ConformanceCase] {
        guard let root = fixture["root"] as? [String: Any] else { throw ConformanceError.malformed("\(tag)/\(name): root") }
        let frame = fixture["frame"] as? String ?? "screen"
        let base = "\(tag)/\(name)"
        let pending = (fixture["pending"] as? [String: Any])?["ios"] as? String
        var out = [ConformanceCase(id: base, tag: tag, frame: frame, batch: try compile(root), pending: pending)]
        for axis in fixture["axes"] as? [[String: Any]] ?? [] {
            guard let prop = axis["prop"] as? String, let values = axis["values"] as? [Any] else { continue }
            for value in values {
                let changed = withProps(root, [prop: value])
                out.append(ConformanceCase(id: "\(base).\(prop)-\(label(value))", tag: tag, frame: frame, batch: try compile(changed), pending: pending))
            }
        }
        for named in fixture["cases"] as? [[String: Any]] ?? [] {
            guard let caseName = named["name"] as? String, let props = named["props"] as? [String: Any] else { continue }
            out.append(ConformanceCase(id: "\(base).\(caseName)", tag: tag, frame: frame, batch: try compile(withProps(root, props)), pending: pending))
        }
        return out
    }

    /// `JSON.stringify` for an axis value's label: `none` for null, a string as is.
    static func label(_ value: Any) -> String {
        if value is NSNull { return "none" }
        if let string = value as? String { return string }
        let data = (try? JSONSerialization.data(withJSONObject: value, options: [.fragmentsAllowed, .sortedKeys])) ?? Data()
        return String(decoding: data, as: UTF8.self)
    }

    static func withProps(_ root: [String: Any], _ changes: [String: Any]) -> [String: Any] {
        var props = root["props"] as? [String: Any] ?? [:]
        for (key, value) in changes {
            if value is NSNull { props.removeValue(forKey: key) } else { props[key] = value }
        }
        var next = root
        next["props"] = props
        return next
    }

    /// The wire batch (`v` 2, `seq` 1) for a fixture tree: `compile.ts` line for line.
    public static func compile(_ root: [String: Any]) throws -> Data {
        var next = 1
        var ops: [[Any]] = []
        func child(_ input: Any) throws -> Int {
            if let text = input as? String {
                let id = next
                next += 1
                ops.append(["create", id, "#text"])
                ops.append(["text", id, text])
                return id
            }
            guard let node = input as? [String: Any] else { throw ConformanceError.malformed("child") }
            return try build(node)
        }
        func build(_ input: [String: Any]) throws -> Int {
            guard let tag = input["tag"] as? String else { throw ConformanceError.malformed("tag") }
            let id = next
            next += 1
            ops.append(["create", id, "hz:\(tag)"])
            // A keyed node carries its key as the wire prop `key` (`row-key`), as `Hazel.key` sends it.
            var props = input["props"] as? [String: Any] ?? [:]
            if let key = input["key"] as? String { props["key"] = key }
            if !props.isEmpty { ops.append(["props", id, props]) }
            if let events = input["events"] as? [String], !events.isEmpty { ops.append(["events", id, events]) }
            for slot in input["slots"] as? [[String: Any]] ?? [] {
                let slotId = next
                next += 1
                ops.append(["create", slotId, "hz:slot"])
                ops.append(["props", slotId, ["name": slot["name"] as? String ?? ""]])
                for content in slot["children"] as? [Any] ?? [] { ops.append(["insert", slotId, try child(content), NSNull()]) }
                ops.append(["insert", id, slotId, NSNull()])
            }
            for content in input["children"] as? [Any] ?? [] { ops.append(["insert", id, try child(content), NSNull()]) }
            return id
        }
        ops.append(["insert", 0, try build(root), NSNull()])
        return try JSONSerialization.data(withJSONObject: ["v": WIRE_VERSION, "seq": 1, "ops": ops])
    }

    /// A fresh tree holding the case, decoded through the real wire decoder.
    @MainActor
    public static func tree(_ c: ConformanceCase) throws -> Tree {
        let tree = Tree()
        try tree.apply(WireDecoder.decode(c.batch))
        return tree
    }
}
