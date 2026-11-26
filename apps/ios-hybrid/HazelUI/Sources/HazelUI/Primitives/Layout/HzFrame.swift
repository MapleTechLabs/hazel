import SwiftUI

// Owned by lane S1 (`docs/hazel-ui.md`, "Phase 2: lanes"). A column on a surface (card, inset, muted,
// overlay, danger, flush, none): its children stretch to its width, spaced by its recipe's row gap.
// `flush` (`frame-flush`) packs its rows edge to edge inside the border, clipped to the corners.
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
        let flush = surface == "flush"
        // The base layer's row gap would part a flush frame's rows; the kit has none there.
        VStack(alignment: .leading, spacing: flush ? 0 : style.rowGap ?? 0) {
            ChildrenView(tree: tree, node: node).frame(maxWidth: .infinity, alignment: .leading)
        }
        .environment(\.hzInRow, false)
        .hzFillWidth(!inRow)
        .hzBox(style)
        .hzClip(flush ? style.radius : nil)
        .hzBorder(style)
        .hzShadow(style)
    }
}

private extension View {
    @ViewBuilder func hzClip(_ radius: CGFloat?) -> some View {
        if let radius { clipShape(RoundedRectangle(cornerRadius: radius, style: .continuous)) } else { self }
    }
}
