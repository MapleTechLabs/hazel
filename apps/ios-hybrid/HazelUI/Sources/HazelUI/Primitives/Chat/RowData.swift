import Foundation

/// One message row as native lays it out: `content.ts`'s `MessageRow` (readable keys) plus the
/// message's own flags. Read from the `row` prop (option C), or out of a message's `hz:*` subtree
/// (the G7 bench's options A and B).
public struct RowData: Sendable, Hashable {
    public enum RunKind: Int, Sendable {
        case plain = 0, mention = 1, link = 2, code = 3, strong = 4, emphasis = 5, strike = 6
    }

    public struct Run: Sendable, Hashable {
        public var kind: RunKind
        public var text: String
        /// A mention's user id, a link's url.
        public var arg: String?
    }

    public enum Block: Sendable, Hashable {
        /// A paragraph, or a list item when it has a marker.
        case paragraph([Run], marker: String?)
        case code(String, language: String)
        case quote([Run])
    }

    public struct Reaction: Sendable, Hashable {
        public var emoji: String
        public var count: Int
        public var mine: Bool
        public var names: [String] = []
        public var others: Int = 0
    }

    public struct Attachment: Sendable, Hashable {
        public enum Kind: String, Sendable { case image, video, file }
        public var id: String
        public var kind: Kind
        public var name: String
        public var size: String?
        public var url: String?
        public var width: Double?
        public var height: Double?
        public var progress: Double?

        // A row draws the same without its ids (event payloads only), so equality leaves them out:
        // the bench's option A subtrees carry no ids but must equal option C's rows.
        public static func == (a: Self, b: Self) -> Bool {
            a.kind == b.kind && a.name == b.name && a.size == b.size && a.url == b.url && a.width == b.width
                && a.height == b.height && a.progress == b.progress
        }

        public func hash(into h: inout Hasher) {
            h.combine(kind); h.combine(name); h.combine(width); h.combine(height); h.combine(progress)
        }
    }

    public struct Embed: Sendable, Hashable {
        public var url: String
        public var title: String?
        public var description: String?
        public var site: String?
        public var image: String?

        /// `site`, else the url's host without `www.` (the web's `hostOf`).
        public var siteLabel: String {
            if let site { return site }
            guard let host = URL(string: url)?.host() else { return url }
            return host.hasPrefix("www.") ? String(host.dropFirst(4)) : host
        }
    }

    public struct Badge: Sendable, Hashable {
        public var label: String
        public var tone: String
    }

    public struct Reply: Sendable, Hashable {
        public var author: String
        public var initials: String
        public var text: String
    }

    public struct Thread: Sendable, Hashable {
        /// The thread's name (`ThreadSummary.name`), which leads the card.
        public var name: String?
        public var count: Int
        public var author: String
        public var initials: String
        public var preview: String
        public var time: String
    }

    public struct Flags: OptionSet, Sendable, Hashable {
        public let rawValue: Int
        public init(rawValue: Int) { self.rawValue = rawValue }
        public static let pinned = Flags(rawValue: 1)
        public static let highlighted = Flags(rawValue: 2)
        public static let entering = Flags(rawValue: 4)
        public static let pending = Flags(rawValue: 8)
        public static let failed = Flags(rawValue: 16)
        /// The node handles `addReaction`, so the bar ends with the add pill.
        public static let addable = Flags(rawValue: 32)

        static let names: [(String, Flags)] = [
            ("pinned", .pinned), ("highlighted", .highlighted), ("entering", .entering), ("pending", .pending), ("failed", .failed),
        ]
    }

    public var author: String?
    public var initials: String?
    public var avatar: String?
    public var provider: String?
    public var time: String
    public var grouped: Bool
    public var blocks: [Block]
    public var reactions: [Reaction]
    public var quick: [String] = []
    public var edited = false
    public var status: String?
    public var badges: [Badge] = []
    public var reply: Reply?
    public var files: [Attachment] = []
    public var embeds: [Embed] = []
    public var thread: Thread?
    public var actions: [String] = []
    public var flags: Flags = []

    /// A grouped row still shows its header when it quotes another message (today's `showAvatar`).
    public var showsHeader: Bool { !grouped || reply != nil }

    /// What a screen reader reads for the row: author, time, the body as text, then attachments.
    public var plainText: String {
        var parts: [String] = []
        if showsHeader, let author { parts.append(author) }
        parts.append(edited ? "\(time), edited" : time)
        if flags.contains(.pinned) { parts.append("pinned") }
        let body = blocks.map(\.plainText).joined(separator: "\n")
        if !body.isEmpty { parts.append(body) }
        for file in files { parts.append(file.name) }
        if flags.contains(.failed) { parts.append("Not sent") }
        return parts.joined(separator: ", ")
    }
}

extension RowData.Block {
    var runs: [RowData.Run] {
        switch self {
        case let .paragraph(runs, _), let .quote(runs): runs
        case let .code(text, _): [RowData.Run(kind: .code, text: text)]
        }
    }

    var plainText: String {
        switch self {
        case let .paragraph(runs, marker): (marker.map { "\($0) " } ?? "") + runs.map(\.text).joined()
        case let .quote(runs): runs.map(\.text).joined()
        case let .code(text, _): text
        }
    }
}

extension RowData.Run {
    init(kind: RowData.RunKind, text: String) { self.init(kind: kind, text: text, arg: nil) }
}

/// A list entry, newest first in the list view.
public enum ListEntry: Sendable, Hashable {
    case message(RowData)
    case date(String)
    /// The unread divider and its label (`New`).
    case unread(String)
    /// Option B: an entry native knows exists but JS has not rendered (outside the window).
    case placeholder
}

// MARK: - Option C: the `row` prop

extension RowData {
    /// Decodes `content.ts`'s `MessageRow`; `grouped` and `flags` are the message's own props.
    public init?(row value: JSONValue, grouped: Bool, flags: Flags = []) {
        guard case let .object(o) = value, let time = o["time"]?.string, case let .array(blocks)? = o["body"] else { return nil }
        self.time = time
        self.grouped = grouped
        self.flags = flags
        self.blocks = blocks.compactMap(RowData.block)
        author = o["author"]?.string
        initials = o["initials"]?.string
        avatar = o["avatar"]?.string
        provider = o["provider"]?.string
        reactions = (o["reactions"]?.array ?? []).compactMap(RowData.reaction)
        quick = (o["quick"]?.array ?? []).compactMap(\.string)
        edited = o["edited"]?.bool ?? false
        status = o["status"]?.string
        badges = (o["badges"]?.array ?? []).compactMap { b in
            guard let f = b.object, let label = f["label"]?.string else { return nil }
            return Badge(label: label, tone: f["tone"]?.string ?? "neutral")
        }
        if let r = o["reply"]?.object, let a = r["author"]?.string {
            reply = Reply(author: a, initials: r["initials"]?.string ?? "", text: r["text"]?.string ?? "")
        }
        files = (o["files"]?.array ?? []).compactMap(RowData.attachment)
        embeds = (o["embeds"]?.array ?? []).compactMap(RowData.embed)
        if let t = o["thread"]?.object, let count = t["count"]?.number {
            thread = Thread(
                name: t["name"]?.string, count: Int(count), author: t["author"]?.string ?? "", initials: t["initials"]?.string ?? "",
                preview: t["preview"]?.string ?? "", time: t["time"]?.string ?? ""
            )
        }
        actions = (o["actions"]?.array ?? []).compactMap(\.string)
    }

    /// The message node's flags as `Flags` (`pinned`, `highlighted`, ...).
    static func flags(_ props: [String: JSONValue], events: Set<String>) -> Flags {
        var out: Flags = []
        for (name, flag) in Flags.names where props[name]?.bool == true { out.insert(flag) }
        if events.contains("addReaction") { out.insert(.addable) }
        return out
    }

    static func reaction(_ value: JSONValue) -> Reaction? {
        guard let f = value.object, let e = f["emoji"]?.string, let c = f["count"]?.number else { return nil }
        let who = f["who"]?.object
        return Reaction(
            emoji: e, count: Int(c), mine: f["mine"]?.bool ?? false,
            names: (who?["names"]?.array ?? []).compactMap(\.string), others: Int(who?["others"]?.number ?? 0)
        )
    }

    static func attachment(_ value: JSONValue) -> Attachment? {
        guard let f = value.object else { return nil }
        return Attachment(
            id: f["id"]?.string ?? "", kind: Attachment.Kind(rawValue: f["kind"]?.string ?? "") ?? .file,
            name: f["name"]?.string ?? "", size: f["size"]?.string, url: f["url"]?.string,
            width: f["width"]?.number, height: f["height"]?.number, progress: f["progress"]?.number
        )
    }

    static func embed(_ value: JSONValue) -> Embed? {
        guard let f = value.object, let url = f["url"]?.string else { return nil }
        return Embed(url: url, title: f["title"]?.string, description: f["description"]?.string, site: f["site"]?.string, image: f["image"]?.string)
    }

    static func block(_ value: JSONValue) -> Block? {
        guard case let .array(f) = value, let kind = f.first?.number else { return nil }
        switch Int(kind) {
        case 1:
            return .code(f[safe: 1]?.string ?? "", language: f[safe: 2]?.string ?? "")
        case 3:
            guard case let .array(runs)? = f[safe: 1] else { return nil }
            return .quote(runs.compactMap(run))
        default:
            guard case let .array(runs)? = f[safe: 1] else { return nil }
            return .paragraph(runs.compactMap(run), marker: kind == 2 ? f[safe: 2]?.string : nil)
        }
    }

    static func run(_ value: JSONValue) -> Run? {
        switch value {
        case let .string(s): return Run(kind: .plain, text: s)
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

// MARK: - Option S: the row as one JSON string

extension RowData {
    /// The same `MessageRow` as `init(row:grouped:)`, from one JSON string (`rowJson`).
    public init?(json: String, grouped: Bool, flags: Flags = []) {
        guard let value = try? JSONDecoder().decode(JSONValue.self, from: Data(json.utf8)) else { return nil }
        self.init(row: value, grouped: grouped, flags: flags)
    }
}

// MARK: - Options A and B: a message's subtree

extension RowData {
    /// Reads a `hz:message` subtree (slots `avatar`, `author`, `time`, `body`, `attachments`, `reactions`).
    @MainActor
    public init(subtree message: Node, in tree: Tree) {
        time = ""
        grouped = message[prop: "grouped"]?.bool ?? false
        blocks = []
        reactions = []
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
                // The bench's image nodes carry only a size; `name` defaults as its option C rows do.
                files = content.children.compactMap(tree.node).map {
                    Attachment(
                        id: "", kind: .image, name: $0[prop: "alt"]?.string ?? "image",
                        width: $0[prop: "width"]?.number ?? 1, height: $0[prop: "height"]?.number ?? 1
                    )
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
