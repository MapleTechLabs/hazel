import SwiftUI

// Owned by lane S2. `hz:link`: link-styled text. A press the view handles goes to the Model (only the
// Model navigates, as on the web); with no `press` handler an `href` opens with the system.
struct HzLink: View {
    let tree: Tree
    let node: Node
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @Environment(\.openURL) private var openURL
    @State private var hovering = false

    var body: some View {
        let sizeClass = HazelTheme.SizeClass(horizontalSizeClass)
        let control = HazelTheme.Recipes.link.style(part: "control", states: hovering ? [.hover] : [], sizeClass: sizeClass)
        let href = node.string("href")
        Button {
            if tree.handles(node.id, "press") {
                tree.fire(node.id, "press")
            } else if let href, let url = URL(string: href) {
                openURL(url)
            }
        } label: {
            Text(node.string("label") ?? "").hzText(control, sizeClass)
        }
        .buttonStyle(.plain)
        .onHover { hovering = $0 }
        .accessibilityRemoveTraits(.isButton)
        .accessibilityAddTraits(href == nil ? .isButton : .isLink)
    }
}
