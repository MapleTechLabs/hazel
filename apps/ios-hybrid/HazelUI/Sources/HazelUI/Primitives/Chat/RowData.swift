import Foundation

/// One message row as native lays it out: what `packages/ui/src/bench/rows.ts` sends as `row` (option C),
/// or what native reads back out of a message's `hz:*` subtree (options A and B).
public struct RowData: Sendable, Hashable {
    public enum RunKind: Int, Sendable { case plain = 0, mention = 1, link = 2, code = 3, strong = 4 }

    public struct Run: Sendable, Hashable {
        public var kind: RunKind
        public var text: String
        public var arg: String?
    }

    public enum Block: Sendable, Hashable {
        case paragraph([Run], marker: String?)
        case code(String, language: String)
    }

    public struct Reaction: Sendable, Hashable {
        public var emoji: String
        public var count: Int
        public var mine: Bool
    }

    public var author: String?
    public var initials: String?
    public var time: String
    public var grouped: Bool
    public var blocks: [Block]
    public var reactions: [Reaction]
    /// Image attachments, by their pixel size (drawn as placeholders).
    public var images: [CGSize]

    /// The text a screen reader reads for the row.
    public var plainText: String {
        let body = blocks.map { block -> String in
            switch block {
            case let .paragraph(runs, marker): (marker.map { "\($0) " } ?? "") + runs.map(\.text).joined()
            case let .code(text, _): text
            }
        }.joined(separator: "\n")
        return [author, time, body].compactMap { $0 }.joined(separator: ", ")
    }
}

/// A list entry, newest first in the list view.
public enum ListEntry: Sendable, Hashable {
    case message(RowData)
    case date(String)
    case unread
    /// Option B: an entry native knows exists but JS has not rendered (outside the window).
    case placeholder
}

// MARK: - Option C: the `row` prop

extension RowData {
    /// Decodes `content.ts`'s `MessageRow` (readable keys: `author`, `initials`, `time`, `body`,
    /// `reactions`, `files`); `grouped` is the message's own flag, not row data.
    public init?(row value: JSONValue, grouped: Bool) {
        guard case let .object(o) = value, let time = o["time"]?.string, case let .array(blocks)? = o["body"] else { return nil }
        self.author = o["author"]?.string
        self.initials = o["initials"]?.string
        self.time = time
        self.grouped = grouped
        self.blocks = blocks.compactMap(RowData.block)
        reactions = (o["reactions"]?.array ?? []).compactMap { r in
            guard let f = r.object, let e = f["emoji"]?.string, let c = f["count"]?.number else { return nil }
            return Reaction(emoji: e, count: Int(c), mine: f["mine"]?.bool ?? false)
        }
        images = (o["files"]?.array ?? []).compactMap { file in
            guard let f = file.object, f["kind"]?.string != "file",
                  let w = f["width"]?.number, let h = f["height"]?.number else { return nil }
            return CGSize(width: w, height: h)
        }
    }

    private static func block(_ value: JSONValue) -> Block? {
        guard case let .array(f) = value, let kind = f.first?.number else { return nil }
        switch Int(kind) {
        case 1:
            return .code(f[safe: 1]?.string ?? "", language: f[safe: 2]?.string ?? "")
        default:
            guard case let .array(runs)? = f[safe: 1] else { return nil }
            return .paragraph(runs.compactMap(run), marker: kind == 2 ? f[safe: 2]?.string : nil)
        }
    }

    private static func run(_ value: JSONValue) -> Run? {
        switch value {
        case let .string(s): return Run(kind: .plain, text: s, arg: nil)
        case let .array(f):
            guard let k = f.first?.number, let text = f[safe: 1]?.string else { return nil }
            return Run(kind: RunKind(rawValue: Int(k)) ?? .plain, text: text, arg: f[safe: 2]?.string)
        default: return nil
        }
    }
}

extension Array {
    subscript(safe index: Int) -> Element? { indices.contains(index) ? self[index] : nil }
}

// MARK: - Option S: the row as one JSON string, decoded straight from Foundation values

extension RowData {
    /// The same `MessageRow` as `init(row:grouped:)`, parsed from its JSON without going through `JSONValue`.
    public init?(json: String, grouped: Bool) {
        guard let any = try? JSONSerialization.jsonObject(with: Data(json.utf8)), let o = any as? [String: Any],
              let time = o["time"] as? String, let blocks = o["body"] as? [Any] else { return nil }
        author = o["author"] as? String
        initials = o["initials"] as? String
        self.time = time
        self.grouped = grouped
        self.blocks = blocks.compactMap { raw -> Block? in
            guard let f = raw as? [Any], let kind = f.first as? Int else { return nil }
            if kind == 1 { return .code(f[safe: 1] as? String ?? "", language: f[safe: 2] as? String ?? "") }
            guard let runs = f[safe: 1] as? [Any] else { return nil }
            return .paragraph(runs.compactMap { r -> Run? in
                if let s = r as? String { return Run(kind: .plain, text: s, arg: nil) }
                guard let f = r as? [Any], let k = f.first as? Int, let text = f[safe: 1] as? String else { return nil }
                return Run(kind: RunKind(rawValue: k) ?? .plain, text: text, arg: f[safe: 2] as? String)
            }, marker: kind == 2 ? f[safe: 2] as? String : nil)
        }
        reactions = (o["reactions"] as? [[String: Any]] ?? []).compactMap { f in
            guard let e = f["emoji"] as? String, let c = f["count"] as? Int else { return nil }
            return Reaction(emoji: e, count: c, mine: (f["mine"] as? Bool) == true)
        }
        images = (o["files"] as? [[String: Any]] ?? []).compactMap { f in
            guard (f["kind"] as? String) != "file", let w = f["width"] as? Double, let h = f["height"] as? Double else { return nil }
            return CGSize(width: w, height: h)
        }
    }
}

// MARK: - Options A and B: a message's subtree

extension RowData {
    /// Reads a `hz:message` subtree (slots `avatar`, `author`, `time`, `body`, `attachments`, `reactions`).
    @MainActor
    public init(subtree message: Node, in tree: Tree) {
        author = nil
        initials = nil
        time = ""
        grouped = message[prop: "grouped"]?.bool ?? false
        blocks = []
        reactions = []
        images = []
        for slotId in message.children {
            guard let slot = tree.node(slotId), let name = slot[prop: "name"]?.string,
                  let content = slot.children.first.flatMap(tree.node) else { continue }
            switch name {
            case "avatar": initials = content[prop: "initials"]?.string
            case "author": author = RowData.text(of: content, in: tree)
            case "time": time = RowData.text(of: content, in: tree)
            case "body":
                blocks = content.children.compactMap(tree.node).map { block in
                    if block.tag == "hz:codeBlock" {
                        return .code(RowData.text(of: block, in: tree), language: block[prop: "language"]?.string ?? "")
                    }
                    let runs = block.children.compactMap(tree.node).map { run in
                        Run(
                            kind: RunKind(rawValue: Int(run[prop: "kind"]?.number ?? 0)) ?? .plain,
                            text: RowData.text(of: run, in: tree),
                            arg: run[prop: "arg"]?.string
                        )
                    }
                    return .paragraph(runs, marker: block[prop: "marker"]?.string)
                }
            case "attachments":
                images = content.children.compactMap(tree.node).map {
                    CGSize(width: $0[prop: "width"]?.number ?? 1, height: $0[prop: "height"]?.number ?? 1)
                }
            case "reactions":
                reactions = content.children.compactMap(tree.node).map {
                    Reaction(
                        emoji: $0[prop: "emoji"]?.string ?? "",
                        count: Int($0[prop: "count"]?.number ?? 0),
                        mine: $0[prop: "mine"]?.bool ?? false
                    )
                }
            default: break
            }
        }
    }

    /// The text under a text node: its own `#text` children, in order.
    @MainActor
    static func text(of node: Node, in tree: Tree) -> String {
        if node.tag == "#text" { return node.text }
        return node.children.compactMap(tree.node).map { $0.tag == "#text" ? $0.text : text(of: $0, in: tree) }.joined()
    }
}
