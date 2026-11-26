import SwiftUI

// Owned by lane S1 (`docs/hazel-ui.md`, "Phase 2: lanes"). `row`: avatars overlapping by their
// recipe's bleed, each ringed in the background colour, then `+N` for the rest. `pair`: the first two
// at 70% in one avatar's box, top left and bottom right, cut out by a 2pt ring (today's group DM mark).
struct HzAvatarStack: View {
    let tree: Tree
    let node: Node
    @Environment(\.horizontalSizeClass) private var horizontal

    var body: some View {
        let _ = RenderCounter.record(node.id)
        let sizeClass = HazelTheme.SizeClass(horizontal)
        let recipe = HazelTheme.Recipes.avatarStack
        let children = recipe.style(part: "children", sizeClass: sizeClass)
        if node[prop: "layout"]?.string == "pair" {
            pair(children, sizeClass)
        } else {
            row(recipe, children, sizeClass)
        }
    }

    private func row(_ recipe: HazelTheme.Recipe, _ children: HazelTheme.Style, _ sizeClass: HazelTheme.SizeClass) -> some View {
        let overflow = recipe.style(part: "overflow", sizeClass: sizeClass)
        let count = Int(node[prop: "overflow"]?.number ?? 0)
        let bleed = children.bleedX ?? 0
        return HStack(alignment: .center, spacing: 0) {
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

    /// The kit's 28pt avatars in a 40pt box: 70% of the first avatar's own size.
    private func pair(_ children: HazelTheme.Style, _ sizeClass: HazelTheme.SizeClass) -> some View {
        let ids = node.children.filter { tree.node($0)?.tag == "hz:avatar" }.prefix(2)
        let first = ids.first.flatMap { tree.node($0) }
        let size = first?[prop: "size"]?.string.map { ["size": $0] } ?? [:]
        let box = HazelTheme.Recipes.avatar.style(options: size, sizeClass: sizeClass).size ?? 20
        let side = (box * 0.7).rounded()
        return ZStack(alignment: .topLeading) {
            ForEach(Array(ids.enumerated()), id: \.element) { index, id in
                if let child = tree.node(id) {
                    NodeView(tree: tree, node: child)
                        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: index == 0 ? .topLeading : .bottomTrailing)
                }
            }
        }
        .frame(width: box, height: box)
        .environment(\.hzAvatarSide, side)
        .environment(\.hzAvatarRing, children.ring)
        .environment(\.hzAvatarCutout, 2)
        .accessibilityElement(children: .combine)
    }
}
