import SwiftUI

/// `hz:listDivider` (lane S5): a day divider or the unread one, the same bitmap the list draws.
struct HzListDivider: View {
    let tree: Tree
    let node: Node

    var body: some View {
        let entry = HzListDivider.entry(node)
        LeafView(tree: tree, node: node, fills: true) { RowRenderer.layout(entry, $0) }
            .accessibilityAddTraits(.isHeader)
    }

    static func entry(_ node: Node) -> ListEntry {
        let label = node[prop: "label"]?.string ?? ""
        return node[prop: "kind"]?.string == "unread" ? .unread(label) : .date(label)
    }
}
