import SwiftUI

// Owned by lane S1 (`docs/hazel-ui.md`, "Phase 2: lanes"). The G8 view, moved here in C0; it reads
// G8's fixture props until the lane draws `hz:text` from `Theme` and its recipe.
struct HzText: View {
    let tree: Tree
    let node: Node

    var body: some View {
        let _ = RenderCounter.record(node.id)
        // Its text arrives as `#text` children (Effect UI's text nodes), or as its own text op.
        Text(node.text + node.children.compactMap { tree.node($0) }.filter { $0.tag == "#text" }.map(\.text).joined())
    }
}
