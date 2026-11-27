import SwiftUI

/// `hz:embed` (lane S5): a link preview card; a press raises `press`.
struct HzEmbed: View {
    let tree: Tree
    let node: Node

    var body: some View {
        if let embed = node[prop: "embed"].flatMap(RowData.embed) {
            LeafView(tree: tree, node: node, fills: false) { RowRenderer.embed(embed, $0) }
        }
    }
}
