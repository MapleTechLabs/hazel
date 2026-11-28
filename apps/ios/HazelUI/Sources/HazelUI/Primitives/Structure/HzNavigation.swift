import SwiftUI

// Owned by lane S4. `hz:navigation`: a `NavigationStack` over its children, the first the root and
// each later one pushed; `rootToolbar` joins the root's bar. The route and the stack follow each other (`NavigationRoute`).
struct HzNavigation: View {
    let tree: Tree
    let node: Node

    @State private var path: [NodeId]

    init(tree: Tree, node: Node) {
        self.tree = tree
        self.node = node
        _path = State(initialValue: NavigationRoute.path(of: tree.content(of: node).map(\.id)))
    }

    var body: some View {
        let _ = RenderCounter.record(node.id)
        let screens = tree.content(of: node).map(\.id)
        let recipe = HazelTheme.Recipes.navigation.style(sizeClass: .compact)
        NavigationStack(path: $path) {
            Group {
                if let root = screens.first.flatMap({ tree.node($0) }) {
                    NodeView(tree: tree, node: root)
                        .environment(\.hzStackRoot, true)
                        .toolbar {
                            // `rootToolbar`: the root's bar end, after the screen's own items.
                            if let items = tree.slot("rootToolbar", of: node), !items.children.isEmpty {
                                ToolbarItem(placement: .topBarTrailing) { ChildrenView(tree: tree, node: items).tint(.primary) }
                            }
                        }
                }
            }
            .navigationDestination(for: NodeId.self) { id in
                // `pushedTabBar: hidden`: a pushed screen has the whole height; the tab bar around this
                // shows again at the root.
                if let screen = tree.node(id) {
                    NodeView(tree: tree, node: screen)
                        .toolbar(node[prop: "pushedTabBar"]?.string == "hidden" ? .hidden : .automatic, for: .tabBar)
                }
            }
        }
        .frame(maxWidth: recipe.fill == true ? .infinity : nil)
        .hzScreenIdealHeight()
        .environment(\.hzNavigationBar, true)
        // The Model pushed or popped: the stack shows it.
        .onChange(of: screens) { _, next in
            let route = NavigationRoute.path(of: next)
            if path != route { path = route }
        }
        // The stack popped (back button, swipe): raise `pop` so the Model follows.
        .onChange(of: path) { _, next in
            switch NavigationRoute.change(route: screens, path: next) {
            case .none:
                break
            case let .pop(depth):
                // Unhandled, the Model keeps its route and the stack goes back to it.
                if !tree.fire(node.id, "pop", ["depth": .number(Double(depth))]) {
                    path = NavigationRoute.path(of: screens)
                }
            case .resync:
                path = NavigationRoute.path(of: screens)
            }
        }
    }
}

/// The mapping between a navigation's children (the route) and its `NavigationStack` path.
enum NavigationRoute {
    enum Change: Equatable {
        /// The path is the route's.
        case none
        /// The stack dropped its top `depth` screens.
        case pop(depth: Int)
        /// The path differs in a way only the Model may cause: restore the route.
        case resync
    }

    /// The pushed screens: every child after the root.
    static func path(of route: [NodeId]) -> [NodeId] { Array(route.dropFirst()) }

    static func change(route: [NodeId], path: [NodeId]) -> Change {
        let expected = Self.path(of: route)
        if path == expected { return .none }
        if path.count < expected.count, Array(expected.prefix(path.count)) == path {
            return .pop(depth: expected.count - path.count)
        }
        return .resync
    }
}
