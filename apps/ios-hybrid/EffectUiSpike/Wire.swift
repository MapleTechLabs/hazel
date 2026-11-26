import Foundation

/// The native wire, v2 (`packages/ui/src/native/wire.ts`): one batch per flush, ops as JSON tuples.
enum Wire {
    static let version = 2
}

/// A prop value as it crossed the wire.
enum JSONValue: Decodable, Equatable {
    case null
    case bool(Bool)
    case number(Double)
    case string(String)
    case array([JSONValue])
    case object([String: JSONValue])

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() { self = .null }
        else if let value = try? container.decode(Bool.self) { self = .bool(value) }
        else if let value = try? container.decode(Double.self) { self = .number(value) }
        else if let value = try? container.decode(String.self) { self = .string(value) }
        else if let value = try? container.decode([JSONValue].self) { self = .array(value) }
        else { self = .object(try container.decode([String: JSONValue].self)) }
    }

    var string: String? { if case let .string(value) = self { value } else { nil } }
    var number: Double? { if case let .number(value) = self { value } else { nil } }
    var bool: Bool? { if case let .bool(value) = self { value } else { nil } }
    var array: [JSONValue]? { if case let .array(value) = self { value } else { nil } }
    var object: [String: JSONValue]? { if case let .object(value) = self { value } else { nil } }
}

enum Op: Decodable {
    case create(id: Int, tag: String)
    case props(id: Int, changed: [String: JSONValue])
    case text(id: Int, text: String)
    case insert(parent: Int, id: Int, before: Int?)
    case remove(id: Int)
    case events(id: Int, names: [String])
    /// Stubbed on the TS side in G1: decoded, ignored.
    case detach(id: Int)
    case command(request: Int, id: Int, name: String)

    init(from decoder: Decoder) throws {
        var tuple = try decoder.unkeyedContainer()
        let name = try tuple.decode(String.self)
        switch name {
        case "create": self = .create(id: try tuple.decode(Int.self), tag: try tuple.decode(String.self))
        case "props": self = .props(id: try tuple.decode(Int.self), changed: try tuple.decode([String: JSONValue].self))
        case "text": self = .text(id: try tuple.decode(Int.self), text: try tuple.decode(String.self))
        case "insert":
            self = .insert(parent: try tuple.decode(Int.self), id: try tuple.decode(Int.self), before: try tuple.decodeIfPresent(Int.self))
        case "remove": self = .remove(id: try tuple.decode(Int.self))
        case "events": self = .events(id: try tuple.decode(Int.self), names: try tuple.decode([String].self))
        case "detach": self = .detach(id: try tuple.decode(Int.self))
        case "command":
            self = .command(request: try tuple.decode(Int.self), id: try tuple.decode(Int.self), name: try tuple.decode(String.self))
        default:
            throw DecodingError.dataCorruptedError(in: tuple, debugDescription: "unknown op \(name)")
        }
    }
}

struct Batch: Decodable {
    let v: Int
    let seq: Int
    let ops: [Op]
}
