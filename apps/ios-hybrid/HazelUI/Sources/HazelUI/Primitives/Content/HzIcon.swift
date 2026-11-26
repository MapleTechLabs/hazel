import SwiftUI

// Owned by lane S1 (`docs/hazel-ui.md`, "Phase 2: lanes"). One of the web's icons in the current ink,
// at the size its container sets (`hzIconSize`), else the icons' own 18pt grid (`HazelIcon`).
struct HzIcon: View {
    let tree: Tree
    let node: Node

    var body: some View {
        HazelIcon(name: node[prop: "name"]?.string ?? "")
    }
}
