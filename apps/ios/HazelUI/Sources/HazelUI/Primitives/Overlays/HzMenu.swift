import SwiftUI

// `hz:menu` on iOS (lane S3): a system menu (`Menu`, so `UIMenu`) on its trigger: the `trigger` slot,
// or the recipe's button with `label` and a chevron. Groups are sections, submenus one level deep; a
// pick raises `select`. The open menu is the system's own and is never drawn in place.
struct HzMenu: View {
    let tree: Tree
    let node: Node
    @Environment(\.horizontalSizeClass) private var horizontal

    var body: some View {
        let sizeClass = HazelTheme.SizeClass(horizontal)
        let recipe = HazelTheme.Recipes.menu
        let label = node.overlayText("label") ?? ""
        Menu {
            OverlayMenuItems(groups: OverlayMenuEntry.groups(node[prop: "entries"])) { id in
                tree.fire(node.id, "select", ["id": .string(id)])
            }
        } label: {
            if let slot = tree.slot("trigger", of: node) {
                // The slot's own control draws the trigger; the menu takes its taps.
                ChildrenView(tree: tree, node: slot).allowsHitTesting(false)
            } else {
                let button = recipe.style(part: "button", sizeClass: sizeClass)
                HStack(spacing: button.gap ?? 0) {
                    Text(label).hzText(button, sizeClass)
                    OverlayPartIcon(name: "chevron-down", style: recipe.style(part: "buttonIcon", sizeClass: sizeClass))
                }
                .hzOverlayPanel(button)
            }
        }
        .menuIndicator(.hidden)
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }
}
