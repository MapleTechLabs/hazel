import SwiftUI

// Owned by lane S1 (`docs/hazel-ui.md`, "Phase 2: lanes"). Phase 1.5: a slot draws its children in
// place (its owner decides where the slot goes); the lane may refine it.
struct HzSlot: View {
    let tree: Tree
    let node: Node

    var body: some View { ChildrenView(tree: tree, node: node) }
}
