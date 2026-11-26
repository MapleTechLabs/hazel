import SwiftUI

// Owned by lane S4 (`docs/hazel-ui.md`, "Phase 2: lanes"). The G8 view, moved here in C0; it reads
// G8's fixture props until the lane draws `hz:item` from `Theme` and its recipe.
struct HzItem: View {
    let tree: Tree
    let node: Node

    var body: some View {
        let _ = RenderCounter.record(node.id)
        let selected = node[prop: "isSelected"]?.bool ?? false
        HStack(spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                if let title = node[prop: "title"]?.string { Text(title).font(.body) }
                if let subtitle = node[prop: "subtitle"]?.string {
                    Text(subtitle).font(.footnote).foregroundStyle(.secondary)
                }
                ChildrenView(tree: tree, node: node)
            }
            Spacer(minLength: 0)
            if let badge = node[prop: "badge"]?.number, badge > 0 {
                Text("\(Int(badge))").font(.caption.weight(.semibold)).monospacedDigit()
            }
        }
        .padding(.vertical, 8)
        .background(selected ? Color.accentColor.opacity(0.12) : .clear)
    }
}
