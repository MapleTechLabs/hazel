import SwiftUI

// Owned by lane S4. `hz:screen`: a title bar over its content, a back button (`back` raises `back`)
// and a `toolbar` slot at the bar's end, `barLeading` at its start. Inside `navigation` or `splitView`
// the bar is the system one, each slot one of its (glass) items.
struct HzScreen: View {
    let tree: Tree
    let node: Node

    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @Environment(\.hzNavigationBar) private var navigationBar
    @Environment(\.hzStackRoot) private var stackRoot

    var body: some View {
        let _ = RenderCounter.record(node.id)
        let sizeClass = HazelTheme.SizeClass(horizontalSizeClass)
        let root = HazelTheme.Recipes.screen.style(sizeClass: sizeClass)
        let title = node[prop: "title"]?.string ?? ""
        if navigationBar {
            let lead = tree.slot("barLeading", of: node).flatMap { $0.children.isEmpty ? nil : $0 }
            // A tab's own page names itself at the bar's start (Slack's), unless its start is taken.
            let leadingTitle = stackRoot && !title.isEmpty && lead == nil
            let titleStyle = HazelTheme.Recipes.screen.style(part: "title", options: ["surface": "page"], sizeClass: sizeClass)
            // The system bar keeps the swipe back; its back button belongs to the stack (`pop`).
            ScreenContent(tree: tree, node: node, sizeClass: sizeClass)
                // A screen inside this one (a framed page's own) is not the stack's root.
                .environment(\.hzStackRoot, false)
                .background(root.background?.color ?? .clear)
                .navigationTitle(title)
                .navigationBarTitleDisplayMode(.inline)
                // The web's header: the screen's own fill under the bar, not glass.
                .toolbarBackground(root.background?.color ?? .clear, for: .navigationBar)
                .toolbarBackground(.visible, for: .navigationBar)
                .toolbar(removing: leadingTitle ? .title : nil)
                .toolbar {
                    if leadingTitle {
                        ToolbarItem(placement: .topBarLeading) {
                            // iOS's root-title size (Slack's), in the theme's ink.
                            Text(title)
                                .font(.title2.weight(.bold))
                                .foregroundStyle(titleStyle.color?.color ?? Color.primary)
                                .fixedSize()
                        }
                        .sharedBackgroundVisibility(.hidden)
                    }
                    // An empty slot is no item: the system would draw an empty glass capsule.
                    // The web's ink for the bar's glyphs (`fg`), not the system's accent tint.
                    if let lead {
                        ToolbarItem(placement: .topBarLeading) { ChildrenView(tree: tree, node: lead).tint(.primary) }
                    }
                    if let tools = tree.slot("toolbar", of: node), !tools.children.isEmpty {
                        ToolbarItem(placement: .topBarTrailing) { ChildrenView(tree: tree, node: tools).tint(.primary) }
                    }
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
/// its scroll view to rows for `item.scrollTo`. The `floatingAction` slot floats over its end corner.
private struct ScreenContent: View {
    let tree: Tree
    let node: Node
    let sizeClass: HazelTheme.SizeClass

    var body: some View {
        let style = HazelTheme.Recipes.screen.style(part: "content", sizeClass: sizeClass)
        // `fill`: the content has the whole height and scrolls itself.
        let fills = node[prop: "fill"]?.bool == true
        let scrolls = fills || tree.content(of: node).contains { $0.tag == "hz:list" || $0.tag == "hz:scroll" }
        // As the web's sticky slot after the last row: 16pt, the 56pt action, then the content's padding.
        let floating = tree.slot("floatingAction", of: node) != nil
        let reserve = floating ? (HazelTheme.space["4"] ?? 0) + (HazelTheme.space["14"] ?? 0) : 0
        let column = VStack(alignment: .leading, spacing: 0) { ScreenChildren(tree: tree, node: node) }
            .padding(.vertical, fills ? 0 : style.paddingY ?? 0)
            .padding(.bottom, reserve)
            .frame(maxWidth: .infinity, alignment: .topLeading)
        Group {
            if scrolls {
                column.frame(maxHeight: .infinity, alignment: .top).environment(\.hzScreenFills, fills)
            } else {
                ScrollViewReader { proxy in
                    ScrollView { column }.environment(\.hzScrollProxy, proxy)
                }
            }
        }
        .overlay(alignment: .bottomTrailing) {
            FloatingAction(tree: tree, node: node).padding(.bottom, style.paddingY ?? 0)
        }
    }
}

/// The screen's children inside its margins (`screen-margins`): 16pt each side, except rows and
/// containers that run edge to edge (sections, items, lists, the people strip) or inset themselves
/// (a stack or scroll with an `inset`).
private struct ScreenChildren: View {
    let tree: Tree
    let node: Node

    static let fullBleed: Set<String> = [
        "hz:section", "hz:item", "hz:list", "hz:listDivider", "hz:scroll", "hz:peopleStrip", "hz:divider", "hz:ext",
    ]

    static func bleeds(_ child: Node) -> Bool {
        fullBleed.contains(child.tag) || (child[prop: "inset"]?.string).map { $0 != "none" } == true
    }

    var body: some View {
        let _ = RenderCounter.recordList(node.id)
        let margin = HazelTheme.space["4"] ?? 0
        ForEach(node.children, id: \.self) { id in
            if let child = tree.node(id), child.tag != "hz:slot" {
                NodeView(tree: tree, node: child)
                    .padding(.horizontal, Self.bleeds(child) ? 0 : margin)
            }
        }
    }
}

/// `floatingAction`: today's DMs compose, a 56pt primary disc with the `lg` shadow around the slot's
/// button, 16pt in from the content's end corner. Not Liquid Glass yet: `layer.render` snapshots draw
/// a glass view black, so the web's disc stands in until the harness captures glass.
private struct FloatingAction: View {
    let tree: Tree
    let node: Node

    var body: some View {
        if let slot = tree.slot("floatingAction", of: node) {
            let side = HazelTheme.space["14"] ?? 0
            let disc = HazelTheme.Style(background: HazelTheme.Colors.primary, radius: side / 2, shadow: "lg")
            HStack(spacing: 0) { ChildrenView(tree: tree, node: slot) }
                .frame(width: side, height: side)
                .background(Circle().fill(HazelTheme.Colors.primary.color))
                .hzShadow(disc)
                .padding(.trailing, HazelTheme.space["4"] ?? 0)
        }
    }
}
