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

/// Draws the root's children.
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

    public var body: some View {
        // The generated registry (`Primitives/Registry.generated.swift`, from vocabulary/spec.ts).
        Primitives.view(tree: tree, node: node)
    }
}

/// A node's children in order. Reads only `children`, so a child's prop change does not reach it.
struct ChildrenView: View {
    let tree: Tree
    let node: Node

    var body: some View {
        let _ = RenderCounter.recordList(node.id)
        ForEach(node.children, id: \.self) { id in
            if let child = tree.node(id) { NodeView(tree: tree, node: child) }
        }
    }
}
