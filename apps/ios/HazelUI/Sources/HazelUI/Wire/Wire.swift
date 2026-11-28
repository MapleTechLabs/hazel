import CoreFoundation
import Foundation
import JavaScriptCore

// The native wire, v2 (contract C2): a hand mirror of `packages/ui/src/native/wire.ts`, the single
// source. `GoldenTests` decodes the shared goldens (`packages/ui/src/native/__goldens__`) to the same
// canonical text as `wire.test.ts`, so a change on one side without the other fails a test.

/// The wire version this build applies; any other `v` is refused.
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
    public var array: [JSONValue]? { if case let .array(a) = self { a } else { nil } }
    public var object: [String: JSONValue]? { if case let .object(o) = self { o } else { nil } }
}

/// Imperative requests (`commandNames` in wire.ts); each gets exactly one `reply`.
public enum CommandName: String, Sendable, Hashable, CaseIterable {
    case focus, blur, scrollTo, measure, select
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
    case command(request: Int, id: NodeId, name: CommandName, args: JSONValue)
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

/// Swift to JS, one JSON array per message to `__hazel.receive(json)`: an event on a node with the
/// last batch applied, or a command's one reply (`ok` false carries an error message).
public enum Inbound: Sendable, Hashable {
    case fire(id: NodeId, event: String, payload: JSONValue, seq: Int)
    case reply(request: Int, ok: Bool, result: JSONValue)
}

public enum WireError: Error, Equatable {
    case malformed(String)
    case unsupportedVersion(Int)
    case unknownOp(String)
}

/// Decodes batches from UTF-8 JSON bytes. Pure and Sendable, so it runs on the JS thread.
public enum WireDecoder {
    public static func decode(_ data: Data) throws -> Batch {
        let root: Any
        do {
            root = try JSONSerialization.jsonObject(with: data)
        } catch {
            throw WireError.malformed("not JSON: \(error.localizedDescription)")
        }
        guard let object = root as? [String: Any] else { throw WireError.malformed("batch is not an object") }
        guard let version = integer(object["v"]) else { throw WireError.malformed("missing v") }
        guard version == WIRE_VERSION else { throw WireError.unsupportedVersion(version) }
        guard let seq = integer(object["seq"]) else { throw WireError.malformed("missing seq") }
        guard let rawOps = object["ops"] as? [Any] else { throw WireError.malformed("missing ops") }
        var ops: [Op] = []
        ops.reserveCapacity(rawOps.count)
        for raw in rawOps { ops.append(try decodeOp(raw)) }
        return Batch(seq: seq, ops: ops)
    }

    public static func decodeInbound(_ data: Data) throws -> Inbound {
        guard let fields = try? JSONSerialization.jsonObject(with: data) as? [Any], let kind = fields.first as? String else {
            throw WireError.malformed("inbound is not [kind, ...]")
        }
        func int(_ i: Int) throws -> Int {
            guard i < fields.count, let n = integer(fields[i]) else { throw WireError.malformed("\(kind): field \(i)") }
            return n
        }
        func json(_ i: Int, _ fallback: JSONValue) -> JSONValue { i < fields.count ? value(fields[i]) : fallback }
        switch kind {
        case "fire":
            guard fields.count > 2, let event = fields[2] as? String else { throw WireError.malformed("fire: field 2") }
            return .fire(id: try int(1), event: event, payload: json(3, .object([:])), seq: try int(4))
        case "reply":
            guard fields.count > 2, let ok = fields[2] as? NSNumber, CFGetTypeID(ok) == CFBooleanGetTypeID() else {
                throw WireError.malformed("reply: field 2")
            }
            return .reply(request: try int(1), ok: ok.boolValue, result: json(3, .null))
        default:
            throw WireError.malformed("unknown inbound \(kind)")
        }
    }

    /// An integral JSON number (not a boolean, which `JSONSerialization` also gives as `NSNumber`).
    private static func integer(_ raw: Any?) -> Int? {
        guard let n = raw as? NSNumber, CFGetTypeID(n) != CFBooleanGetTypeID() else { return nil }
        let d = n.doubleValue
        return d == d.rounded() && abs(d) < 9e15 ? Int(d) : nil
    }

    private static func decodeOp(_ raw: Any) throws -> Op {
        guard let fields = raw as? [Any], let name = fields.first as? String else {
            throw WireError.malformed("op is not [name, ...]")
        }
        func int(_ i: Int) throws -> Int {
            guard i < fields.count, let n = integer(fields[i]) else { throw WireError.malformed("\(name): field \(i)") }
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
        case "command":
            guard let command = CommandName(rawValue: try string(3)) else { throw WireError.malformed("command: field 3") }
            let args = fields.count > 4 ? value(fields[4]) : .null
            return .command(request: try int(1), id: try int(2), name: command, args: args)
        default:
            throw WireError.unknownOp(name)
        }
    }

    static func value(_ raw: Any) -> JSONValue {
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

/// Encodes what Swift sends back, as the JSON array `decodeInbound` in wire.ts reads.
public enum WireEncoder {
    public static func encode(_ message: Inbound) -> Data {
        let fields: [Any] = switch message {
        case let .fire(id, event, payload, seq): ["fire", id, event, any(payload), seq]
        case let .reply(request, ok, result): ["reply", request, ok, any(result)]
        }
        return (try? JSONSerialization.data(withJSONObject: fields, options: [.fragmentsAllowed])) ?? Data("[]".utf8)
    }

    static func any(_ value: JSONValue) -> Any {
        switch value {
        case .null: NSNull()
        case let .bool(b): b
        case let .number(n): n == n.rounded() && abs(n) < 9e15 ? Int(n) as Any : n
        case let .string(s): s
        case let .array(a): a.map(any)
        case let .object(o): o.mapValues(any)
        }
    }
}

/// The canonical text both sides print for the same message (`describeOp` in wire.ts).
public enum WireText {
    public static func describe(_ value: JSONValue) -> String {
        switch value {
        case .null: "null"
        case let .bool(b): "\(b)"
        case let .number(n): n == n.rounded() && abs(n) < 1e15 ? "\(Int(n))" : "\(n)"
        case let .string(s): "\"\(s)\""
        case let .array(a): "[" + a.map(describe).joined(separator: ",") + "]"
        case let .object(o): "{" + o.keys.sorted().map { "\($0):\(describe(o[$0]!))" }.joined(separator: ",") + "}"
        }
    }

    public static func describe(_ op: Op) -> String {
        switch op {
        case let .create(id, tag): "create \(id) \(tag)"
        case let .props(id, changed):
            "props \(id) {" + changed.keys.sorted().map { "\($0)=\(describe(changed[$0]!))" }.joined(separator: ",") + "}"
        case let .text(id, text): "text \(id) \"\(text)\""
        case let .insert(parent, id, before): "insert \(parent) \(id) \(before.map(String.init) ?? "null")"
        case let .remove(id): "remove \(id)"
        case let .events(id, names): "events \(id) [\(names.joined(separator: ","))]"
        case let .detach(id): "detach \(id)"
        case let .command(request, id, name, args): "command \(request) \(id) \(name.rawValue) \(describe(args))"
        }
    }

    public static func describe(_ message: Inbound) -> String {
        switch message {
        case let .fire(id, event, payload, seq): "fire \(id) \(event) \(describe(payload)) \(seq)"
        case let .reply(request, ok, result): "reply \(request) \(ok) \(describe(result))"
        }
    }
}

/// A JS string as UTF-8 bytes straight from JavaScriptCore, never through `NSString` or `String` (G7:
/// that conversion was the main decode cost). Batches cross this way.
public enum WireBytes {
    public static func utf8(_ value: JSValue?) -> Data {
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
}
