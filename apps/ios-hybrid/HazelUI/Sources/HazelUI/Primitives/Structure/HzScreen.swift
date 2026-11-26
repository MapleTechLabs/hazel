import SwiftUI

// Owned by lane S4 (`docs/hazel-ui.md`, "Phase 2: lanes"). The G8 view, moved here in C0; it reads
// G8's fixture props until the lane draws `hz:screen` from `Theme` and its recipe.
struct HzScreen: View {
    let tree: Tree
    let node: Node

    var body: some View {
        let _ = RenderCounter.record(node.id)
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if let title = node[prop: "title"]?.string { Text(title).font(.largeTitle.bold()) }
                ChildrenView(tree: tree, node: node)
            }
            .padding(16)
        }
    }
}
