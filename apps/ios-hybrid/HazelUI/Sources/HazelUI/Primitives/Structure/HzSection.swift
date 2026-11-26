import SwiftUI

// Owned by lane S4 (`docs/hazel-ui.md`, "Phase 2: lanes"). The G8 view, moved here in C0; it reads
// G8's fixture props until the lane draws `hz:section` from `Theme` and its recipe.
struct HzSection: View {
    let tree: Tree
    let node: Node

    var body: some View {
        let _ = RenderCounter.record(node.id)
        VStack(alignment: .leading, spacing: 0) {
            if let title = node[prop: "title"]?.string {
                Text(title).font(.footnote.weight(.semibold)).foregroundStyle(.secondary).padding(.bottom, 6)
            }
            ChildrenView(tree: tree, node: node)
        }
    }
}
