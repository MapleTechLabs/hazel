import CoreFoundation
import Foundation

/// The wire version this build applies (`docs/hazel-ui.md`, "Native host and the wire").
public let WIRE_VERSION = 2

/// A node id the JS host assigns; 0 is the root.
public typealias NodeId = Int

/// A JSON prop value. Numbers are doubles, as in JavaScript.
public enum JSONValue: Sendable, Hashable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([JSONValue])
    case object([String: JSONValue])

    public var string: String? { if case let .string(s) = self { s } else { nil } }
    public var number: Double? { if case let .number(n) = self { n } else { nil } }
    public var bool: Bool? { if case let .bool(b) = self { b } else { nil } }
}

/// One op of a batch. `props` carries only changed keys; a null value deletes the key.
public enum Op: Sendable, Hashable {
    case create(id: NodeId, tag: String)
    case props(id: NodeId, changed: [String: JSONValue])
    case text(id: NodeId, text: String)
    case insert(parent: NodeId, id: NodeId, before: NodeId?)
    case remove(id: NodeId)
    case events(id: NodeId, names: [String])
    case detach(id: NodeId)
}

/// One flush from the JS host: `{"v": 2, "seq": n, "ops": [[name, ...fields], ...]}`.
public struct Batch: Sendable, Hashable {
    public let seq: Int
    public let ops: [Op]

    public init(seq: Int, ops: [Op]) {
        self.seq = seq
        self.ops = ops
    }
}

public enum WireError: Error, Equatable {
    case malformed(String)
    case unsupportedVersion(Int)
    case unknownOp(String)
}

/// Decodes batches from JSON. Pure and Sendable, so it runs on any thread (the JS thread on device).
public enum WireDecoder {
    public static func decode(_ data: Data) throws -> Batch {
        let root: Any
        do {
            root = try JSONSerialization.jsonObject(with: data)
        } catch {
            throw WireError.malformed("not JSON: \(error.localizedDescription)")
        }
        guard let object = root as? [String: Any] else { throw WireError.malformed("batch is not an object") }
        guard let version = object["v"] as? Int else { throw WireError.malformed("missing v") }
        guard version == WIRE_VERSION else { throw WireError.unsupportedVersion(version) }
        guard let seq = object["seq"] as? Int else { throw WireError.malformed("missing seq") }
        guard let rawOps = object["ops"] as? [Any] else { throw WireError.malformed("missing ops") }
        var ops: [Op] = []
        ops.reserveCapacity(rawOps.count)
        for raw in rawOps { ops.append(try decodeOp(raw)) }
        return Batch(seq: seq, ops: ops)
    }

    private static func decodeOp(_ raw: Any) throws -> Op {
        guard let fields = raw as? [Any], let name = fields.first as? String else {
            throw WireError.malformed("op is not [name, ...]")
        }
        func int(_ i: Int) throws -> Int {
            guard i < fields.count, let n = fields[i] as? Int else { throw WireError.malformed("\(name): field \(i)") }
            return n
        }
        func string(_ i: Int) throws -> String {
            guard i < fields.count, let s = fields[i] as? String else { throw WireError.malformed("\(name): field \(i)") }
            return s
        }
        switch name {
        case "create":
            return .create(id: try int(1), tag: try string(2))
        case "props":
            guard fields.count > 2, let changed = fields[2] as? [String: Any] else {
                throw WireError.malformed("props: field 2")
            }
            return .props(id: try int(1), changed: changed.mapValues(value))
        case "text":
            return .text(id: try int(1), text: try string(2))
        case "insert":
            let before: NodeId? = fields.count > 3 && !(fields[3] is NSNull) ? try int(3) : nil
            return .insert(parent: try int(1), id: try int(2), before: before)
        case "remove":
            return .remove(id: try int(1))
        case "events":
            guard fields.count > 2, let names = fields[2] as? [String] else { throw WireError.malformed("events: field 2") }
            return .events(id: try int(1), names: names)
        case "detach":
            return .detach(id: try int(1))
        default:
            throw WireError.unknownOp(name)
        }
    }

    private static func value(_ raw: Any) -> JSONValue {
        switch raw {
        case let n as NSNumber:
            // JSONSerialization gives booleans as the CFBoolean singleton.
            CFGetTypeID(n) == CFBooleanGetTypeID() ? .bool(n.boolValue) : .number(n.doubleValue)
        case let s as String: .string(s)
        case let a as [Any]: .array(a.map(value))
        case let o as [String: Any]: .object(o.mapValues(value))
        default: .null
        }
    }
}
