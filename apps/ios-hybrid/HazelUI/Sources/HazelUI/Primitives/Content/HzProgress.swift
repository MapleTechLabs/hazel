import SwiftUI

// Owned by lane S1 (`docs/hazel-ui.md`, "Phase 2: lanes"). A labelled bar filled to `value` (0 to 1),
// or with `indeterminate` a 40% fill sweeping across (`progressSweep`; at rest under Reduce Motion).
struct HzProgress: View {
    let tree: Tree
    let node: Node
    @Environment(\.horizontalSizeClass) private var horizontal
    @Environment(\.hzInRow) private var inRow

    var body: some View {
        let sizeClass = HazelTheme.SizeClass(horizontal)
        let recipe = HazelTheme.Recipes.progress
        let root = recipe.style(sizeClass: sizeClass)
        let labelStyle = recipe.style(part: "label", sizeClass: sizeClass)
        let track = recipe.style(part: "track", sizeClass: sizeClass)
        let fill = recipe.style(part: "fill", sizeClass: sizeClass)
        let label = node[prop: "label"]?.string ?? ""
        let indeterminate = node[prop: "indeterminate"]?.bool == true
        let value = min(1, max(0, node[prop: "value"]?.number ?? 0))
        VStack(alignment: .leading, spacing: root.rowGap ?? 0) {
            if !label.isEmpty {
                Text(label).hzParagraph(labelStyle, sizeClass)
            }
            GeometryReader { proxy in
                let width = proxy.size.width
                let fraction = indeterminate ? 0.4 : value
                Capsule()
                    .fill(fill.background?.color ?? .clear)
                    .frame(width: width * fraction, height: fill.minHeight ?? 6)
                    .hzLoop("progress", part: "fill", running: indeterminate)
            }
            .frame(height: track.minHeight ?? 6)
            .background(Capsule().fill(track.background?.color ?? .clear))
            .clipShape(Capsule())
        }
        .hzFillWidth(!inRow || root.fill == true)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(label)
        .accessibilityValue(indeterminate ? "" : "\(Int((value * 100).rounded()))%")
    }
}
