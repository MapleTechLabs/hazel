import SwiftUI

// Owned by lane S4. `hz:screen`: a title bar over its content, a back button (`back` raises `back`)
// and a `toolbar` slot at the bar's end. Inside `navigation` or `splitView` the bar is the system one.
struct HzScreen: View {
    let tree: Tree
    let node: Node

    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @Environment(\.hzNavigationBar) private var navigationBar

    var body: some View {
        let _ = RenderCounter.record(node.id)
        let sizeClass = HazelTheme.SizeClass(horizontalSizeClass)
        let root = HazelTheme.Recipes.screen.style(sizeClass: sizeClass)
        let title = node[prop: "title"]?.string ?? ""
        if navigationBar {
            // The system bar keeps the swipe back; its back button belongs to the stack (`pop`).
            ScreenContent(tree: tree, node: node, sizeClass: sizeClass)
                .background(root.background?.color ?? .clear)
                .navigationTitle(title)
                .navigationBarTitleDisplayMode(.inline)
                // The web's header: the screen's own fill under the bar, not glass.
                .toolbarBackground(root.background?.color ?? .clear, for: .navigationBar)
                .toolbarBackground(.visible, for: .navigationBar)
                .toolbar {
                    ToolbarItem(placement: .topBarTrailing) { SlotView(tree: tree, node: node, name: "toolbar") }
                }
        } else {
            VStack(alignment: .leading, spacing: 0) {
                ScreenHeader(tree: tree, node: node, title: title, back: node[prop: "back"]?.bool == true,
                             sizeClass: sizeClass)
                ScreenContent(tree: tree, node: node, sizeClass: sizeClass)
            }
            .background(root.background?.color ?? .clear)
        }
    }
}

/// The web's title bar: back button, title, toolbar slot, over a hairline.
private struct ScreenHeader: View {
    let tree: Tree
    let node: Node
    let title: String
    let back: Bool
    let sizeClass: HazelTheme.SizeClass

    @State private var hovering = false

    var body: some View {
        let recipe = HazelTheme.Recipes.screen
        let header = recipe.style(part: "header", sizeClass: sizeClass)
        let titleStyle = recipe.style(part: "title", sizeClass: sizeClass)
        let toolbar = recipe.style(part: "toolbar", sizeClass: sizeClass)
        HStack(spacing: header.gap ?? 0) {
            if back {
                Button { tree.fire(node.id, "back") } label: { EmptyView() }
                    .buttonStyle(PressStyle { pressed in backFace(pressed: pressed) })
                    .onHover { hovering = $0 }
                    .accessibilityLabel("Back")
            }
            Text(title)
                .lineLimit(1)
                .hzText(titleStyle, sizeClass)
                .opacity(titleStyle.opacity ?? 1)
                .accessibilityAddTraits(.isHeader)
                .frame(maxWidth: .infinity, alignment: .leading)
            HStack(spacing: toolbar.gap ?? 0) { SlotView(tree: tree, node: node, name: "toolbar") }
                .foregroundStyle(HazelTheme.Colors.fg3.color)
        }
        .padding(.horizontal, header.paddingX ?? 0)
        .frame(minHeight: header.minHeight)
        .overlay(alignment: .bottom) {
            if let divider = header.divider { Rectangle().fill(divider.color).frame(height: 1) }
        }
    }

    /// The back part: a 32pt square whose chevron bleeds into the header's padding.
    private func backFace(pressed: Bool) -> some View {
        // A recipe's interaction states are the root's; the web draws the back button's own in CSS.
        let style = HazelTheme.Recipes.screen.style(part: "back", sizeClass: sizeClass)
        let active = pressed || hovering
        let shape = RoundedRectangle(cornerRadius: style.radius ?? 0, style: .continuous)
        return StructureIcon.image("chevron-right")
            .resizable()
            .scaledToFit()
            .scaleEffect(x: -1)
            .padding(style.paddingX ?? 0)
            .hzSize(style)
            .foregroundStyle(active ? HazelTheme.Colors.fg.color : style.color?.color ?? Color.primary)
            .background(shape.fill(active ? HazelTheme.Colors.wash.color : .clear))
            .contentShape(shape)
            .padding(.leading, -(style.bleedX ?? 0))
    }
}

/// The content column. It scrolls unless it holds its own scroller (`list`, `scroll`), and hands
/// its scroll view to rows for `item.scrollTo`.
private struct ScreenContent: View {
    let tree: Tree
    let node: Node
    let sizeClass: HazelTheme.SizeClass

    var body: some View {
        let style = HazelTheme.Recipes.screen.style(part: "content", sizeClass: sizeClass)
        let scrolls = tree.content(of: node).contains { $0.tag == "hz:list" || $0.tag == "hz:scroll" }
        let column = VStack(alignment: .leading, spacing: 0) { ChildrenView(tree: tree, node: node) }
            .padding(.vertical, style.paddingY ?? 0)
            .frame(maxWidth: .infinity, alignment: .topLeading)
        if scrolls {
            column.frame(maxHeight: .infinity, alignment: .top)
        } else {
            ScrollViewReader { proxy in
                ScrollView { column }.environment(\.hzScrollProxy, proxy)
            }
        }
    }
}
