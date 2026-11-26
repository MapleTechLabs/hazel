import SwiftUI

/// `hz:reactionBar` (lane S5): wrapping reaction pills, and the add pill when `addable`.
struct HzReactionBar: View {
    let tree: Tree
    let node: Node

    var body: some View {
        let reactions = (node[prop: "reactions"]?.array ?? []).compactMap(RowData.reaction)
        let addable = node[prop: "addable"]?.bool ?? false
        LeafView(tree: tree, node: node, fills: false) { RowRenderer.reactionBar(reactions, addable: addable, $0) }
    }
}
