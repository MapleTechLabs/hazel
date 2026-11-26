import SwiftUI

// Owned by lane S1 (`docs/hazel-ui.md`, "Phase 2: lanes"). One of the web's icons in the current ink,
// at the size its container sets (`hzIconSize`), else the icons' own 18pt grid.
struct HzIcon: View {
    let tree: Tree
    let node: Node
    @Environment(\.hzIconSize) private var size

    static let naturalSize: CGFloat = 18

    var body: some View {
        let side = size ?? Self.naturalSize
        Glyph(name: node[prop: "name"]?.string ?? "")
            .frame(width: side, height: side)
            .accessibilityHidden(true)
    }
}
