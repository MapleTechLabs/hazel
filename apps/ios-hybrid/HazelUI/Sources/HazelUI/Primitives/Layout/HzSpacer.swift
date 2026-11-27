import SwiftUI

// Owned by lane S1 (`docs/hazel-ui.md`, "Phase 2: lanes"). Takes the free space of its stack (`grow`).
struct HzSpacer: View {
    let tree: Tree
    let node: Node

    var body: some View {
        Spacer(minLength: 0).accessibilityHidden(true)
    }
}
