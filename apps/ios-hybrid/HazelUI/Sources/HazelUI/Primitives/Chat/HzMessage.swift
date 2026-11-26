import SwiftUI

/// `hz:message` (lane S5): one chat row from its `row` data and its own flags, drawn by
/// `RowRenderer.message`, the same bitmap the list draws. Presses reach the row's targets.
struct HzMessage: View {
    let tree: Tree
    let node: Node

    var body: some View {
        if let row = HzMessage.row(node) {
            LeafView(tree: tree, node: node, fills: true) { RowRenderer.message(row, $0) }
        }
    }

    /// The node's row: its `row` prop (or `rowJson`), with `grouped` and the state flags.
    static func row(_ node: Node) -> RowData? {
        let grouped = node[prop: "grouped"]?.bool ?? false
        let flags = RowData.flags(node.props, events: node.events)
        if let json = node[prop: "rowJson"]?.string { return RowData(json: json, grouped: grouped, flags: flags) }
        return node[prop: "row"].flatMap { RowData(row: $0, grouped: grouped, flags: flags) }
    }
}
