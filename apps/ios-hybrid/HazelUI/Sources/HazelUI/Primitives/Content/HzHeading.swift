import SwiftUI

// Owned by lane S1 (`docs/hazel-ui.md`, "Phase 2: lanes"). A page (1), section (2) or group (3) title.
struct HzHeading: View {
    let tree: Tree
    let node: Node
    @Environment(\.horizontalSizeClass) private var horizontal

    var body: some View {
        let _ = RenderCounter.record(node.id)
        let sizeClass = HazelTheme.SizeClass(horizontal)
        let level = node[prop: "level"]?.string
        let style = HazelTheme.Recipes.heading.style(options: level.map { ["level": $0] } ?? [:], sizeClass: sizeClass)
        HzText.runs(tree, node, sizeClass)
            .hzParagraph(style, sizeClass)
            .accessibilityAddTraits(.isHeader)
    }
}
