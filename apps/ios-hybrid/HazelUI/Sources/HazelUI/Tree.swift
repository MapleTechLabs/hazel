import Foundation
import Observation

/// One node of the tree. Each is its own observable object, so a view that reads one node
/// re-evaluates only when that node's props, text or children change.
@Observable
@MainActor
public final class Node {
    public let id: NodeId
    public let tag: String
    public internal(set) var props: [String: JSONValue] = [:]
    public internal(set) var text: String = ""
    public internal(set) var children: [NodeId] = []
    public internal(set) var events: Set<String> = []
    @ObservationIgnored public internal(set) var parent: NodeId?

    init(id: NodeId, tag: String) {
        self.id = id
        self.tag = tag
    }

    public subscript(prop key: String) -> JSONValue? { props[key] }
}

public enum TreeError: Error, Equatable {
    case outOfOrder(expected: Int, got: Int)
    case unknownNode(NodeId)
    case duplicateNode(NodeId)
}

/// The native side of the tree. The node table itself is not observed: views hold their `Node`
/// and look children up only when a parent's `children` changes.
@MainActor
public final class Tree {
    public static let rootId: NodeId = 0

    private var nodes: [NodeId: Node]
    /// Kept-alive subtrees outside the tree (`detach`), until reinserted or removed.
    public private(set) var detached: Set<NodeId> = []
    public private(set) var lastSeq = 0
    /// Nodes whose props, text or children the last batch changed (a removed node's parent counts).
    public private(set) var touched: Set<NodeId> = []

    public init() {
        nodes = [Tree.rootId: Node(id: Tree.rootId, tag: "#root")]
    }

    public var root: Node { nodes[Tree.rootId]! }
    public var count: Int { nodes.count }
    public func node(_ id: NodeId) -> Node? { nodes[id] }

    /// Applies one batch. Batches must arrive in sequence: a gap means the tree is wrong.
    public func apply(_ batch: Batch) throws {
        guard batch.seq == lastSeq + 1 else { throw TreeError.outOfOrder(expected: lastSeq + 1, got: batch.seq) }
        touched.removeAll(keepingCapacity: true)
        for op in batch.ops { try apply(op) }
        lastSeq = batch.seq
    }

    private func apply(_ op: Op) throws {
        switch op {
        case let .create(id, tag):
            guard nodes[id] == nil else { throw TreeError.duplicateNode(id) }
            nodes[id] = Node(id: id, tag: tag)
        case let .props(id, changed):
            let node = try lookup(id)
            var next = node.props
            for (key, value) in changed {
                if value == .null { next.removeValue(forKey: key) } else { next[key] = value }
            }
            // One write per op, and none when nothing differs, so observers fire once or not at all.
            if next != node.props {
                node.props = next
                touched.insert(id)
            }
        case let .text(id, text):
            let node = try lookup(id)
            if node.text != text {
                node.text = text
                touched.insert(id)
            }
        case let .insert(parentId, id, before):
            let parent = try lookup(parentId)
            let child = try lookup(id)
            unlink(child)
            let index = before.flatMap { parent.children.firstIndex(of: $0) } ?? parent.children.count
            parent.children.insert(id, at: index)
            child.parent = parentId
            touched.insert(parentId)
        case let .remove(id):
            let node = try lookup(id)
            unlink(node)
            free(node)
        case let .events(id, names):
            let node = try lookup(id)
            let next = Set(names)
            if node.events != next { node.events = next }
        case let .detach(id):
            let node = try lookup(id)
            unlink(node)
            detached.insert(id)
        }
    }

    private func lookup(_ id: NodeId) throws -> Node {
        guard let node = nodes[id] else { throw TreeError.unknownNode(id) }
        return node
    }

    private func unlink(_ node: Node) {
        detached.remove(node.id)
        guard let parentId = node.parent else { return }
        touched.insert(parentId)
        if let parent = nodes[parentId], let index = parent.children.firstIndex(of: node.id) {
            parent.children.remove(at: index)
        }
        node.parent = nil
    }

    private func free(_ node: Node) {
        for child in node.children {
            if let c = nodes[child] { free(c) }
        }
        nodes.removeValue(forKey: node.id)
        detached.remove(node.id)
    }

    /// The tree under `id` as an indented outline, for goldens and debugging.
    public func outline(_ id: NodeId = Tree.rootId, depth: Int = 0) -> String {
        guard let node = nodes[id] else { return "" }
        var line = String(repeating: "  ", count: depth) + "\(node.tag)#\(node.id)"
        if !node.props.isEmpty {
            let parts = node.props.keys.sorted().map { "\($0)=\(Tree.describe(node.props[$0]!))" }
            line += " {" + parts.joined(separator: ",") + "}"
        }
        if !node.text.isEmpty { line += " \"\(node.text)\"" }
        if !node.events.isEmpty { line += " on[" + node.events.sorted().joined(separator: ",") + "]" }
        return ([line] + node.children.map { outline($0, depth: depth + 1) }).joined(separator: "\n")
    }

    private static func describe(_ value: JSONValue) -> String {
        switch value {
        case .null: "null"
        case let .bool(b): "\(b)"
        case let .number(n): n == n.rounded() && abs(n) < 1e15 ? "\(Int(n))" : "\(n)"
        case let .string(s): "\"\(s)\""
        case let .array(a): "[" + a.map(describe).joined(separator: ",") + "]"
        case let .object(o): "{" + o.keys.sorted().map { "\($0):\(describe(o[$0]!))" }.joined(separator: ",") + "}"
        }
    }
}
