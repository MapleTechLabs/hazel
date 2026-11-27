import SwiftUI

// Owned by lane S1 (`docs/hazel-ui.md`, "Phase 2: lanes"). The kit's `iconTile` (`md`): the recipe's
// glyph on its tinted, bordered square, per `tone`. Decoration, hidden from assistive technology.
struct HzIconTile: View {
    let tree: Tree
    let node: Node
    @Environment(\.horizontalSizeClass) private var horizontal

    var body: some View {
        let _ = RenderCounter.record(node.id)
        let sizeClass = HazelTheme.SizeClass(horizontal)
        let options = node.options(["tone"])
        let recipe = HazelTheme.Recipes.iconTile
        let root = recipe.style(options: options, sizeClass: sizeClass)
        let icon = recipe.style(part: "icon", options: options, sizeClass: sizeClass)
        let side = root.size ?? 40
        HazelIcon(name: node[prop: "name"]?.string ?? "", size: icon.size)
            .foregroundStyle(root.color?.color ?? Color.primary)
            .frame(width: side, height: side)
            .hzBox(root)
            .hzBorder(root)
            .accessibilityHidden(true)
    }
}
