import SwiftUI

// Owned by lane S3 (`docs/hazel-ui.md`, "Phase 2: lanes"). C0 stub: the lane draws `hz:contextMenu` here
// from `HazelTheme` and its recipe; until then it is a `NotImplementedView`.
struct HzContextMenu: View {
    let tree: Tree
    let node: Node

    var body: some View { NotImplementedView(tag: node.tag, lane: "S3") }
}
