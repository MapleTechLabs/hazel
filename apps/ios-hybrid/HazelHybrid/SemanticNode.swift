import Foundation

/// A node of the page's semantic tree (`web/semantic-tree.ts`, `web-foldkit/src/ui/semantic.ts`).
struct SemanticNode: Decodable, Identifiable, Equatable {
    let id: String
    let kind: String
    let props: JSONValue
    /// How the web draws it; what the native view draws it like.
    let look: Look?
    let children: [SemanticNode]

    var title: String { props["title"]?.string ?? "" }
    var text: String { props["text"]?.string ?? "" }
}

/// A row's long-press menu entry (`NativeMenuItem` in `web-foldkit/src/platform/native-island.ts`).
struct MenuEntry: Identifiable {
    enum Kind { case item(key: String, isDestructive: Bool, isChecked: Bool), separator, submenu([MenuEntry]) }
    let id: String
    let label: String
    let symbol: String?
    /// The web item's own icon, rasterized by the page (`withMenuIcons`): a key into `WebBridge.icons`.
    let image: String?
    let kind: Kind

    static func parse(_ value: JSONValue?) -> [MenuEntry] {
        guard case let .array(items)? = value else { return [] }
        return items.enumerated().compactMap { index, item in
            if item["separator"]?.bool == true {
                return MenuEntry(id: "sep\(index)", label: "", symbol: nil, image: nil, kind: .separator)
            }
            let label = item["label"]?.string ?? ""
            if case .array? = item["items"] {
                return MenuEntry(id: "sub\(index)", label: label, symbol: nil, image: nil, kind: .submenu(parse(item["items"])))
            }
            guard let key = item["key"]?.string else { return nil }
            return MenuEntry(
                id: key,
                label: label,
                symbol: item["symbol"]?.string,
                image: item["image"]?.string,
                kind: .item(
                    key: key,
                    isDestructive: item["destructive"]?.bool == true,
                    isChecked: item["checked"]?.bool == true
                )
            )
        }
    }
}

/// Any JSON value: a node's props are whatever its kind carries.
enum JSONValue: Decodable, Equatable {
    case string(String), number(Double), bool(Bool), object([String: JSONValue]), array([JSONValue]), null

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() { self = .null }
        else if let value = try? container.decode(Bool.self) { self = .bool(value) }
        else if let value = try? container.decode(Double.self) { self = .number(value) }
        else if let value = try? container.decode(String.self) { self = .string(value) }
        else if let value = try? container.decode([JSONValue].self) { self = .array(value) }
        else { self = .object(try container.decode([String: JSONValue].self)) }
    }

    subscript(key: String) -> JSONValue? {
        if case let .object(object) = self { return object[key] }
        return nil
    }

    var string: String? { if case let .string(value) = self { value } else { nil } }
    var bool: Bool? { if case let .bool(value) = self { value } else { nil } }
    var int: Int? { if case let .number(value) = self { Int(value) } else { nil } }
}
