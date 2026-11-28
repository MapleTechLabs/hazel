import SwiftUI

// Owned by lane S1 (`docs/hazel-ui.md`, "Phase 2: lanes"). `hz:banner`: a notice in its tone's
// colours, its icon, title and description, its content, the `actions` slot, and a dismiss button.
// `callout` is a padded card; `bar` a single row (a channel's join or sync strip).
struct HzBanner: View {
    let tree: Tree
    let node: Node
    @Environment(\.horizontalSizeClass) private var horizontal

    var body: some View {
        let sizeClass = HazelTheme.SizeClass(horizontal)
        let options = node.options(["tone", "style"])
        let part = { (name: String?) in HazelTheme.Recipes.banner.style(part: name, options: options, sizeClass: sizeClass) }
        let root = part(nil), icon = part("icon"), content = part("content"), dismiss = part("dismiss")
        let bar = options["style"] == "bar"
        let title = node[prop: "title"]?.string ?? ""
        let description = node[prop: "description"]?.string ?? ""
        HStack(alignment: bar ? .center : .top, spacing: root.gap ?? 0) {
            if let name = node[prop: "icon"]?.string {
                HazelIcon(name: name, size: icon.size ?? 20)
                    .padding(.vertical, icon.paddingY ?? 0)
                    .accessibilityHidden(true)
            }
            VStack(alignment: .leading, spacing: content.rowGap ?? 0) {
                if !title.isEmpty {
                    Text(title).hzParagraph(Self.inherit(part("title"), root), sizeClass)
                        .lineLimit(bar ? 1 : nil)
                }
                if !description.isEmpty {
                    Text(description).hzParagraph(Self.inherit(part("description"), root), sizeClass)
                }
                ChildrenView(tree: tree, node: node)
                if let actions = tree.slot("actions", of: node), !actions.children.isEmpty {
                    HStack(spacing: part("actions").gap ?? 0) { SlotView(tree: tree, node: node, name: "actions") }
                        .padding(.top, part("actions").paddingTop ?? 0)
                        .environment(\.hzInRow, true)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if node[prop: "dismissible"]?.bool == true {
                Button { tree.fire(node.id, "dismiss") } label: {
                    HazelIcon(name: "close", size: (dismiss.size ?? 20) - 2 * (dismiss.paddingX ?? 0))
                        .frame(width: dismiss.size ?? 20, height: dismiss.size ?? 20)
                }
                .buttonStyle(.plain)
                .opacity(dismiss.opacity ?? 1)
                .accessibilityLabel("Dismiss")
            }
        }
        .foregroundStyle(root.color?.color ?? Color.primary)
        .hzBox(root)
        .hzBorder(root)
        .accessibilityElement(children: .contain)
    }

    /// A text part with the root's text role and ink where it sets none (CSS inherits them).
    static func inherit(_ part: HazelTheme.Style, _ root: HazelTheme.Style) -> HazelTheme.Style {
        var out = part
        out.text = part.text ?? root.text
        out.color = part.color ?? root.color
        return out
    }
}
