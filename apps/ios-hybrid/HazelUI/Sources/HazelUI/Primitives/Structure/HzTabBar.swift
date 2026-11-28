import SwiftUI

// Owned by lane S4. `hz:tabBar`: the system tab bar (`TabView`) over the selected tab's content (the
// children). A tap raises `change {id}`; the bar moves when the Model sets `selected`.
struct HzTabBar: View {
    let tree: Tree
    let node: Node

    var body: some View {
        let tabs = (try? node[prop: "tabs"]?.decode([TabData].self)) ?? []
        let chosen = node[prop: "selected"]?.string
        let current = tabs.contains { $0.id == chosen } ? chosen ?? "" : tabs.first?.id ?? ""
        let selection = Binding(
            get: { current },
            set: { id in if id != current { tree.fire(node.id, "change", ["id": .string(id)]) } }
        )
        TabView(selection: selection) {
            ForEach(tabs, id: \.id) { tab in
                Tab(value: tab.id) {
                    if tab.id == current { TabPanel(tree: tree, node: node) }
                } label: {
                    Label { Text(tab.label) } icon: { StructureIcon.image(tab.icon) }
                }
                .badge(Int(tab.badge ?? 0))
            }
        }
        // The selected tab in the brand colour, as the web's bar.
        .tint(HazelTheme.Colors.primary.color)
        .hzScreenIdealHeight()
    }
}

/// The selected tab's content: the tab bar's children, top aligned on the recipe's panel.
private struct TabPanel: View {
    let tree: Tree
    let node: Node

    var body: some View {
        let recipe = HazelTheme.Recipes.tabBar
        let root = recipe.style(sizeClass: .compact)
        let bar = recipe.style(part: "bar", sizeClass: .compact)
        VStack(alignment: .leading, spacing: 0) { ChildrenView(tree: tree, node: node) }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .background(root.background?.color ?? .clear)
            .toolbarBackground(bar.background?.color ?? .clear, for: .tabBar)
            .toolbarBackground(.visible, for: .tabBar)
    }
}

/// `Content.Tab` (`content.ts`).
private struct TabData: Decodable {
    let id: String
    let label: String
    let icon: String
    let badge: Double?
}
