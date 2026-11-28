import SwiftUI

// Owned by lane S4 (`docs/hazel-ui.md`, "Phase 2: lanes"). C0 stub: the lane draws `hz:actionBar` here
// from `HazelTheme` and its recipe; until then it is a `NotImplementedView`.
struct HzActionBar: View {
    let tree: Tree
    let node: Node

    var body: some View { NotImplementedView(tag: node.tag, lane: "S4") }
}
