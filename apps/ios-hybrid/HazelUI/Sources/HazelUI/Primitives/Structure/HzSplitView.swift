import SwiftUI

// Owned by lane S4. `hz:splitView`: a `NavigationSplitView`, the `sidebar` slot in its sidebar column
// and the children as its detail. Compact, it collapses to a stack that shows the detail on change.
struct HzSplitView: View {
    let tree: Tree
    let node: Node

    @State private var compactColumn: NavigationSplitViewColumn = .sidebar

    var body: some View {
        let detail = tree.content(of: node).map(\.id)
        let recipe = HazelTheme.Recipes.splitView
        let root = recipe.style(sizeClass: .regular)
        let sidebar = recipe.style(part: "sidebar", sizeClass: .regular)
        NavigationSplitView(preferredCompactColumn: $compactColumn) {
            ScrollView {
                VStack(alignment: .leading, spacing: 0) { SlotView(tree: tree, node: node, name: "sidebar") }
                    .frame(maxWidth: .infinity, alignment: .topLeading)
            }
            .background(sidebar.background?.color ?? .clear)
            .toolbar(.hidden, for: .navigationBar)
            // The web's sidebar is 5 * space-12 wide.
            .navigationSplitViewColumnWidth((HazelTheme.space["12"] ?? 0) * 5)
        } detail: {
            VStack(alignment: .leading, spacing: 0) { ChildrenView(tree: tree, node: node) }
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
                .background(root.background?.color ?? .clear)
                .environment(\.hzNavigationBar, true)
        }
        .navigationSplitViewStyle(.balanced)
        .hzScreenIdealHeight()
        // The Model chose new detail (a channel): a compact split view shows it.
        .onChange(of: detail) { _, next in if !next.isEmpty { compactColumn = .detail } }
    }
}
