import SwiftUI

/// Counts view body evaluations per node id, in debug builds only. Not observable, so recording
/// inside a body never invalidates anything.
@MainActor
public enum RenderCounter {
    #if DEBUG
    public private(set) static var counts: [NodeId: Int] = [:]
    /// Evaluations of a node's child list (`ChildrenView`), apart from the node's own view.
    public private(set) static var listCounts: [NodeId: Int] = [:]
    public static func record(_ id: NodeId) { counts[id, default: 0] += 1 }
    public static func recordList(_ id: NodeId) { listCounts[id, default: 0] += 1 }
    public static func reset() { counts = [:]; listCounts = [:] }
    #else
    public static var counts: [NodeId: Int] { [:] }
    public static var listCounts: [NodeId: Int] { [:] }
    @inline(__always) public static func record(_ id: NodeId) {}
    @inline(__always) public static func recordList(_ id: NodeId) {}
    public static func reset() {}
    #endif
}

/// Draws the root's children: the one entry point a host puts on screen.
public struct TreeView: View {
    let tree: Tree
    public init(tree: Tree) { self.tree = tree }

    public var body: some View {
        let root = tree.root
        ForEach(root.children, id: \.self) { id in
            if let node = tree.node(id) { NodeView(tree: tree, node: node) }
        }
    }
}

/// Picks the primitive for a node's tag. Holds references only, so SwiftUI sees equal inputs
/// and skips its body unless the node itself is observed changing.
public struct NodeView: View {
    let tree: Tree
    let node: Node

    public init(tree: Tree, node: Node) {
        self.tree = tree
        self.node = node
    }

    public var body: some View {
        // The generated registry (`Primitives/Registry.generated.swift`, from vocabulary/spec.ts).
        // A keyed node (`row-key`) carries its key as its identity, so `scrollTo({key})` finds it.
        if let key = node[prop: "key"]?.string {
            Primitives.view(tree: tree, node: node).id(RowKey(key))
        } else {
            Primitives.view(tree: tree, node: node)
        }
    }
}

/// A node's wire key (`Hazel.KEY_PROP`) as a SwiftUI identity, for `ScrollViewProxy.scrollTo`.
public struct RowKey: Hashable, Sendable {
    public let key: String
    public init(_ key: String) { self.key = key }
}

/// A node's children in order. Reads only `children` (and a slot child's name), so a child's prop
/// change does not reach it. Slots are left out unless `slots` is true: a primitive places each
/// slot itself (`SlotView`).
struct ChildrenView: View {
    let tree: Tree
    let node: Node
    var slots = false

    var body: some View {
        let _ = RenderCounter.recordList(node.id)
        ForEach(node.children, id: \.self) { id in
            if let child = tree.node(id), slots || child.tag != "hz:slot" { NodeView(tree: tree, node: child) }
        }
    }
}

/// The children of `node`'s slot `name`, or nothing when it has none.
struct SlotView: View {
    let tree: Tree
    let node: Node
    let name: String

    var body: some View {
        if let slot = tree.slot(name, of: node) { ChildrenView(tree: tree, node: slot) }
    }
}

extension View {
    /// Answers the commands sent to `node` (`focus`, `scrollTo`, ...) while this view is on screen.
    /// Commands that arrive before it appears wait for it (`Tree.commandTimeout`).
    public func hazelCommands(_ tree: Tree, _ node: Node, _ handler: @escaping CommandHandler) -> some View {
        modifier(CommandsModifier(tree: tree, id: node.id, handler: handler))
    }
}

private struct CommandsModifier: ViewModifier {
    let tree: Tree
    let id: NodeId
    let handler: CommandHandler
    @State private var token: UUID?

    func body(content: Content) -> some View {
        content
            .onAppear { token = tree.setCommandHandler(id, handler) }
            .onDisappear {
                if let token { tree.removeCommandHandler(id, token: token) }
                token = nil
            }
    }
}
