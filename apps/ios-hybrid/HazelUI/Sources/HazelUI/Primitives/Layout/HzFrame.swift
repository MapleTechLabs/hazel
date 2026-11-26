import SwiftUI

// Owned by lane S1 (`docs/hazel-ui.md`, "Phase 2: lanes"). A column on a surface (card, inset, muted,
// overlay, danger, none): its children stretch to its width, spaced by its recipe's row gap.
struct HzFrame: View {
    let tree: Tree
    let node: Node
    @Environment(\.horizontalSizeClass) private var horizontal
    @Environment(\.hzInRow) private var inRow

    var body: some View {
        let _ = RenderCounter.record(node.id)
        let sizeClass = HazelTheme.SizeClass(horizontal)
        let surface = node[prop: "surface"]?.string
        let style = HazelTheme.Recipes.frame.style(options: surface.map { ["surface": $0] } ?? [:], sizeClass: sizeClass)
        VStack(alignment: .leading, spacing: style.rowGap ?? 0) {
            ChildrenView(tree: tree, node: node).frame(maxWidth: .infinity, alignment: .leading)
        }
        .environment(\.hzInRow, false)
        .hzFillWidth(!inRow)
        .hzBox(style)
        .hzBorder(style)
        .hzShadow(style)
    }
}
