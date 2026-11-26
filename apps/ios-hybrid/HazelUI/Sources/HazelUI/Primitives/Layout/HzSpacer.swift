import SwiftUI

// Owned by lane S1 (`docs/hazel-ui.md`, "Phase 2: lanes"). C0 stub: the lane draws `hz:spacer` here
// from `HazelTheme` and its recipe; until then it is a `NotImplementedView`.
struct HzSpacer: View {
    let tree: Tree
    let node: Node

    var body: some View { NotImplementedView(tag: node.tag, lane: "S1") }
}
