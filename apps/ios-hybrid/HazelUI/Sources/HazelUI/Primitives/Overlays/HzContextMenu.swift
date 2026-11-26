import SwiftUI

// `hz:contextMenu` on iOS (lane S3): the system context menu (`contextMenu`, a long press or a
// secondary click) on its children, from the same entries as `hz:menu`; a pick raises `select`.
// The open menu is the system's own and is never drawn in place.
struct HzContextMenu: View {
    let tree: Tree
    let node: Node

    var body: some View {
        VStack(alignment: .leading, spacing: 0) { ChildrenView(tree: tree, node: node) }
            .contentShape(Rectangle())
            .contextMenu {
                OverlayMenuItems(groups: OverlayMenuEntry.groups(node[prop: "entries"])) { id in
                    tree.fire(node.id, "select", ["id": .string(id)])
                }
            }
    }
}
