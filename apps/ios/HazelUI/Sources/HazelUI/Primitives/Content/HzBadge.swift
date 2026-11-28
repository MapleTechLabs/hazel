import SwiftUI

// Owned by lane S1 (`docs/hazel-ui.md`, "Phase 2: lanes"). A short label in a tone, style and size.
struct HzBadge: View {
    let tree: Tree
    let node: Node
    @Environment(\.horizontalSizeClass) private var horizontal

    var body: some View {
        let sizeClass = HazelTheme.SizeClass(horizontal)
        let options = node.options(["tone", "style", "size"])
        let flags: Set<String> = node[prop: "pill"]?.bool == true ? ["pill"] : []
        let style = HazelTheme.Recipes.badge.style(options: options, flags: flags, sizeClass: sizeClass)
        Text(node[prop: "label"]?.string ?? "")
            .lineLimit(1)
            .fixedSize()
            .tracking(style.tracking(sizeClass))
            .hzText(style, sizeClass)
            .hzBox(style)
            .hzBorder(style)
    }
}
