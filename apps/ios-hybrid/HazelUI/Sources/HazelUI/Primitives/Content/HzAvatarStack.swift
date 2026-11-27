import SwiftUI

// Owned by lane S1 (`docs/hazel-ui.md`, "Phase 2: lanes"). `row`: avatars overlapping by their
// recipe's bleed, each ringed in the background colour, then `+N` for the rest. `pair`: the first two
// at 28pt in a medium avatar's box, top left and bottom right, cut out by a 2pt ring (today's group
// DM mark).
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

    /// The web's pair: a `medium` avatar's box holding two 28pt (`space-7`) `rounded-xl` avatars.
    private func pair(_ children: HazelTheme.Style, _ sizeClass: HazelTheme.SizeClass) -> some View {
        let ids = node.children.filter { tree.node($0)?.tag == "hz:avatar" }.prefix(2)
        let box = HazelTheme.Recipes.avatar.style(options: ["size": "medium"], sizeClass: sizeClass).size ?? 40
        let side = HazelTheme.space["7"] ?? 28
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
        .environment(\.hzAvatarRadius, HazelTheme.radius["xl"])
        .environment(\.hzAvatarRing, children.ring)
        .environment(\.hzAvatarCutout, 2)
        .accessibilityElement(children: .combine)
    }
}
