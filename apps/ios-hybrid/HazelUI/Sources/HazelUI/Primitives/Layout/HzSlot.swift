import SwiftUI

// Owned by lane S1 (`docs/hazel-ui.md`, "Phase 2: lanes"). A slot draws its children in place: the
// primitive that owns the slot lays them out (`SlotView`).
struct HzSlot: View {
    let tree: Tree
    let node: Node

    var body: some View {
        ChildrenView(tree: tree, node: node)
    }
}
