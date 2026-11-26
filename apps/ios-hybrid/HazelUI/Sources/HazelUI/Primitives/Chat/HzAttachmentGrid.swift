import SwiftUI

/// `hz:attachmentGrid` (lane S5): media in a mosaic, then file cards; `removable` adds remove buttons.
struct HzAttachmentGrid: View {
    let tree: Tree
    let node: Node

    var body: some View {
        let list = (node[prop: "attachments"]?.array ?? []).compactMap(RowData.attachment)
        let removable = node[prop: "removable"]?.bool ?? false
        LeafView(tree: tree, node: node, fills: false) { RowRenderer.attachmentGrid(list, removable: removable, $0) }
    }
}
