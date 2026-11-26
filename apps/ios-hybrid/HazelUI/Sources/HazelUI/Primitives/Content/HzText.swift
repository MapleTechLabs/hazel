import SwiftUI

// Owned by lane S1 (`docs/hazel-ui.md`, "Phase 2: lanes"). The G8 view, moved here in C0; it reads
// G8's fixture props until the lane draws `hz:text` from `Theme` and its recipe.
struct HzText: View {
    let tree: Tree
    let node: Node

    var body: some View {
        let _ = RenderCounter.record(node.id)
        Text(node.text)
    }
}
