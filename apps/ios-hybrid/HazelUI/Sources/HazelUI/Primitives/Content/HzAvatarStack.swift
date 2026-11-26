import SwiftUI

// Owned by lane S1 (`docs/hazel-ui.md`, "Phase 2: lanes"). Avatars overlapping by their recipe's bleed,
// each ringed in the background colour, then `+N` for the rest.
struct HzAvatarStack: View {
    let tree: Tree
    let node: Node
    @Environment(\.horizontalSizeClass) private var horizontal

    var body: some View {
        let _ = RenderCounter.record(node.id)
        let sizeClass = HazelTheme.SizeClass(horizontal)
        let recipe = HazelTheme.Recipes.avatarStack
        let children = recipe.style(part: "children", sizeClass: sizeClass)
        let overflow = recipe.style(part: "overflow", sizeClass: sizeClass)
        let count = Int(node[prop: "overflow"]?.number ?? 0)
        let bleed = children.bleedX ?? 0
        HStack(alignment: .center, spacing: 0) {
            ChildrenView(tree: tree, node: node)
                .padding(.horizontal, -bleed)
                .environment(\.hzAvatarRing, children.ring)
            if count > 0 {
                Text("+\(count)")
                    .lineLimit(1)
                    .fixedSize()
                    .hzText(overflow, sizeClass)
                    .padding(.leading, overflow.paddingStart ?? 0)
                    .accessibilityLabel("\(count) more")
            }
        }
        .environment(\.hzInRow, true)
        .fixedSize()
    }
}
