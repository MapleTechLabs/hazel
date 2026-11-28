import SwiftUI

/// `hz:ext`: an extension's placeholder (`h.extension(def, props)`). Draws the view registered under
/// its `ext` name with its `args`; otherwise its `fallback` slot, or nothing.
struct HzExt: View {
    let tree: Tree
    let node: Node
    @Environment(\.horizontalSizeClass) private var horizontal
    @Environment(\.hzScreenFills) private var screenFills

    var body: some View {
        let _ = RenderCounter.record(node.id)
        let sizeClass = HazelTheme.SizeClass(horizontal)
        let root = HazelTheme.Recipes.ext.style(sizeClass: sizeClass)
        let name = node[prop: "ext"]?.string ?? ""
        let id = node.id
        let tree = tree
        Group {
            // Like the web, it draws only once it has both its name and its props.
            if let args = node[prop: "args"],
               let view = HazelExtensions.view(name, args: args, send: { event, payload in tree.fire(id, event, payload) }) {
                view
            } else if tree.slot("fallback", of: node) != nil {
                VStack(alignment: .leading, spacing: 0) { SlotView(tree: tree, node: node, name: "fallback") }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .hzBox(HazelTheme.Recipes.ext.style(part: "content", sizeClass: sizeClass))
            }
        }
        // In a screen whose content fills it, the extension is the content: edge to edge.
        .padding(.horizontal, screenFills ? 0 : root.marginX ?? 0)
        .padding(.bottom, screenFills ? 0 : root.marginBottom ?? 0)
    }
}
