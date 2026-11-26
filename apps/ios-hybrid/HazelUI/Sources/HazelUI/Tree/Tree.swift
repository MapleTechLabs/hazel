import Foundation
import Observation
import os

/// One node of the tree. Each is its own observable object, so a view that reads one node
/// re-evaluates only when that node's props, text or children change (G8).
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

/// What a command handler throws to answer `ok: false`; the message is the reply's result.
public struct CommandError: Error, Equatable, Sendable {
    public let message: String
    public init(_ message: String) { self.message = message }
}

/// A primitive's answer to one command (`focus`, `blur`, `scrollTo`, `measure`, `select`): the
/// reply's result, or a thrown `CommandError` for `ok: false`.
public typealias CommandHandler = @MainActor (_ name: CommandName, _ args: JSONValue) async throws -> JSONValue

/// The native side of the tree. The node table itself is not observed: views hold their `Node`
/// and look children up only when a parent's `children` changes.
@MainActor
public final class Tree {
    public static let rootId: NodeId = 0
    static let log = Logger(subsystem: "sh.hazel.ui", category: "tree")

    private var nodes: [NodeId: Node]
    /// Kept-alive subtrees outside the tree (`detach`), until reinserted or removed.
    public private(set) var detached: Set<NodeId> = []
    public private(set) var lastSeq = 0
    /// Nodes whose props, text or children the last batch changed (a removed node's parent counts).
    public private(set) var touched: Set<NodeId> = []

    /// Where `fire` and `reply` go (`TreeHost` sends them to `__hazel.receive`). Unset, they are dropped.
    public var outbound: (@MainActor (Inbound) -> Void)?
    /// How long a command waits for its node's view to register a handler before it fails.
    public var commandTimeout: Duration = .seconds(2)

    private struct Handler {
        let token: UUID
        let run: CommandHandler
    }

    private struct PendingCommand {
        let request: Int
        let name: CommandName
        let args: JSONValue
    }

    private var handlers: [NodeId: Handler] = [:]
    /// Commands whose node has no handler yet (its view has not appeared), oldest first.
    private var waiting: [NodeId: [PendingCommand]] = [:]

    public init() {
        nodes = [Tree.rootId: Node(id: Tree.rootId, tag: "#root")]
    }

    public var root: Node { nodes[Tree.rootId]! }
    public var count: Int { nodes.count }
    public func node(_ id: NodeId) -> Node? { nodes[id] }

    /// Applies one batch. Batches must arrive in sequence: a gap means the tree is wrong. Commands run
    /// after the batch's tree ops, so a command may target a node the same batch created.
    public func apply(_ batch: Batch) throws {
        guard batch.seq == lastSeq + 1 else { throw TreeError.outOfOrder(expected: lastSeq + 1, got: batch.seq) }
        touched.removeAll(keepingCapacity: true)
        var commands: [(NodeId, PendingCommand)] = []
        for op in batch.ops {
            if case let .command(request, id, name, args) = op {
                _ = try lookup(id)
                commands.append((id, PendingCommand(request: request, name: name, args: args)))
            } else {
                try apply(op)
            }
        }
        lastSeq = batch.seq
        for (id, command) in commands { dispatch(id, command) }
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
        case .command:
            break
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
        handlers.removeValue(forKey: node.id)
        for command in waiting.removeValue(forKey: node.id) ?? [] {
            reply(command.request, ok: false, .string("node \(node.id) was removed"))
        }
    }

    // MARK: events

    /// Whether `event` on `id` reaches a handler: the JS host looks it up on the node, then its
    /// ancestors (`host.ts` `fire`).
    public func handles(_ id: NodeId, _ event: String) -> Bool {
        var at = nodes[id]
        while let node = at {
            if node.events.contains(event) { return true }
            at = node.parent.flatMap { nodes[$0] }
        }
        return false
    }

    /// Sends `["fire", id, event, payload, lastSeq]`. Returns whether some node on the way up declared
    /// the event; it is sent either way, since JS decides.
    @discardableResult
    public func fire(_ id: NodeId, _ event: String, _ payload: JSONValue = .object([:])) -> Bool {
        outbound?(.fire(id: id, event: event, payload: payload, seq: lastSeq))
        return handles(id, event)
    }

    // MARK: commands

    /// Registers the view's command handler for `id` and runs any commands waiting for it. Returns a
    /// token for `removeCommandHandler`, so a view that went away cannot clear its successor's handler.
    @discardableResult
    public func setCommandHandler(_ id: NodeId, _ run: @escaping CommandHandler) -> UUID {
        let token = UUID()
        handlers[id] = Handler(token: token, run: run)
        for command in waiting.removeValue(forKey: id) ?? [] { dispatch(id, command) }
        return token
    }

    public func removeCommandHandler(_ id: NodeId, token: UUID) {
        if handlers[id]?.token == token { handlers.removeValue(forKey: id) }
    }

    /// Exactly one reply per request: from the handler, or a failure when the node is removed or no
    /// handler appears within `commandTimeout`.
    private func dispatch(_ id: NodeId, _ command: PendingCommand) {
        guard nodes[id] != nil else {
            reply(command.request, ok: false, .string("node \(id) was removed"))
            return
        }
        guard let handler = handlers[id] else {
            waiting[id, default: []].append(command)
            let timeout = commandTimeout
            Task { [weak self] in
                try? await Task.sleep(for: timeout)
                self?.expire(id, command.request)
            }
            return
        }
        Task {
            do {
                let result = try await handler.run(command.name, command.args)
                self.reply(command.request, ok: true, result)
            } catch let error as CommandError {
                self.reply(command.request, ok: false, .string(error.message))
            } catch {
                self.reply(command.request, ok: false, .string("\(error)"))
            }
        }
    }

    private func expire(_ id: NodeId, _ request: Int) {
        guard var list = waiting[id], let index = list.firstIndex(where: { $0.request == request }) else { return }
        let command = list.remove(at: index)
        waiting[id] = list.isEmpty ? nil : list
        let tag = nodes[id]?.tag ?? "?"
        Self.log.error("command \(command.name.rawValue, privacy: .public) on \(tag, privacy: .public)#\(id): no handler")
        reply(request, ok: false, .string("\(tag) does not handle \(command.name.rawValue)"))
    }

    private func reply(_ request: Int, ok: Bool, _ result: JSONValue) {
        outbound?(.reply(request: request, ok: ok, result: result))
    }

    // MARK: reading

    /// The slot named `name` among `node`'s children (`hz:slot`, from `.leading(...)`, `.fallback(...)`).
    public func slot(_ name: String, of node: Node) -> Node? {
        for id in node.children {
            if let child = nodes[id], child.tag == "hz:slot", child.props["name"]?.string == name { return child }
        }
        return nil
    }

    /// `node`'s children that are not slots: what a container lays out.
    public func content(of node: Node) -> [Node] {
        node.children.compactMap { nodes[$0] }.filter { $0.tag != "hz:slot" }
    }

    /// The text under `node`: its own text, then its descendants' in order (what `hz:text` draws).
    public func text(of node: Node) -> String {
        node.children.reduce(into: node.text) { out, id in
            if let child = nodes[id] { out += text(of: child) }
        }
    }

    /// The tree under `id` as an indented outline, for goldens and debugging.
    public func outline(_ id: NodeId = Tree.rootId, depth: Int = 0) -> String {
        guard let node = nodes[id] else { return "" }
        var line = String(repeating: "  ", count: depth) + "\(node.tag)#\(node.id)"
        if !node.props.isEmpty {
            let parts = node.props.keys.sorted().map { "\($0)=\(WireText.describe(node.props[$0]!))" }
            line += " {" + parts.joined(separator: ",") + "}"
        }
        if !node.text.isEmpty { line += " \"\(node.text)\"" }
        if !node.events.isEmpty { line += " on[" + node.events.sorted().joined(separator: ",") + "]" }
        return ([line] + node.children.map { outline($0, depth: depth + 1) }).joined(separator: "\n")
    }
}
