import Foundation

/// Reads a `hz:list` out of the tree as entries, newest first, keyed by node id. After each batch,
/// `refresh()` rebuilds only what the batch touched: a row whose subtree changed is read again, and
/// the order is rebuilt only when the list's children changed.
@MainActor
public final class ListSource {
    public let tree: Tree
    public private(set) var listId: NodeId?
    /// Newest first: a row's node id, or for a placeholder (option B) `-(index + 1)`.
    public private(set) var keys: [Int] = []
    public private(set) var entries: [ListEntry] = []
    private var cache: [NodeId: ListEntry] = [:]
    /// Rows read from the tree so far (decoded from `row`, or walked out of a subtree).
    public private(set) var reads = 0

    public init(tree: Tree) { self.tree = tree }

    /// Option B: how many entries the list has in all, and the index of the newest one rendered.
    public var total: Int? { list?[prop: "total"]?.number.map(Int.init) }
    public var offset: Int { Int(list?[prop: "offset"]?.number ?? 0) }

    private var list: Node? { listId.flatMap(tree.node) }

    /// Returns the keys of rows whose data changed, or nil when nothing about the list changed.
    @discardableResult
    public func refresh() -> Set<Int>? {
        if listId == nil { listId = find(tree.root)?.id }
        guard let listId, let list else { return nil }
        var dirty: Set<Int> = []
        var reorder = keys.isEmpty
        for id in tree.touched {
            if id == listId { reorder = true; continue }
            // The row is the touched node's ancestor directly under the list.
            var at = tree.node(id)
            while let node = at, let parent = node.parent, parent != listId { at = tree.node(parent) }
            guard let row = at, row.parent == listId else { continue }
            cache[row.id] = nil
            dirty.insert(row.id)
        }
        if !reorder && dirty.isEmpty { return nil }
        var nextKeys: [Int] = []
        var nextEntries: [ListEntry] = []
        let children = list.children
        let total = self.total ?? children.count
        let offset = self.total == nil ? 0 : self.offset
        nextKeys.reserveCapacity(total)
        nextEntries.reserveCapacity(total)
        for index in 0..<offset { nextKeys.append(-(index + 1)); nextEntries.append(.placeholder) }
        for id in children.reversed() {
            nextKeys.append(id)
            nextEntries.append(entry(id))
        }
        while nextKeys.count < total { nextKeys.append(-(nextKeys.count + 1)); nextEntries.append(.placeholder) }
        if reorder {
            let live = Set(children)
            cache = cache.filter { live.contains($0.key) }
        }
        keys = nextKeys
        entries = nextEntries
        return dirty
    }

    private func entry(_ id: NodeId) -> ListEntry {
        if let hit = cache[id] { return hit }
        guard let node = tree.node(id) else { return .placeholder }
        reads += 1
        let made: ListEntry
        switch node.tag {
        case "hz:listDivider":
            made = node[prop: "kind"]?.string == "unread" ? .unread : .date(node[prop: "label"]?.string ?? "")
        case "hz:message":
            if let json = node[prop: "rowJson"]?.string {
                made = RowData(json: json).map(ListEntry.message) ?? .placeholder
            } else if let row = node[prop: "row"] {
                made = RowData(compact: row).map(ListEntry.message) ?? .placeholder
            } else {
                made = .message(RowData(subtree: node, in: tree))
            }
        default:
            made = .placeholder
        }
        cache[id] = made
        return made
    }

    private func find(_ node: Node) -> Node? {
        if node.tag == "hz:list" { return node }
        for id in node.children {
            if let child = tree.node(id), let hit = find(child) { return hit }
        }
        return nil
    }
}
