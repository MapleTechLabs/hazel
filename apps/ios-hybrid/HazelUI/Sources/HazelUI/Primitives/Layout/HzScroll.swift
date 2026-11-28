import SwiftUI

// Owned by lane S1 (`docs/hazel-ui.md`, "Phase 2: lanes"). Scrolls along its recipe's `overflow` axis
// (else its `axis`) when its content overflows; content that fits is drawn as is (`overflow: auto`).
// Answers `scrollTo` an edge or a keyed descendant (`row-key`, `NodeView`'s `RowKey`).
struct HzScroll: View {
    let tree: Tree
    let node: Node
    @Environment(\.horizontalSizeClass) private var horizontal
    @Environment(\.hzInRow) private var inRow

    var body: some View {
        let _ = RenderCounter.record(node.id)
        let style = HazelTheme.Recipes.scroll.style(options: node.options(["axis", "inset"]), sizeClass: HazelTheme.SizeClass(horizontal))
        let row = style.scrollAxes.map { $0 == .horizontal } ?? (style.layout == .row)
        let tree = tree, node = node
        ScrollViewReader { proxy in
            ViewThatFits(in: row ? .horizontal : .vertical) {
                content(row).hzInset(style)
                // The gutter scrolls with the content, as the web's padding does.
                ScrollView(row ? .horizontal : .vertical) { content(row).hzInset(style) }
            }
            .hazelCommands(tree, node) { name, args in
                guard name == .scrollTo else { throw CommandError("scroll does not handle \(name.rawValue)") }
                let animation = Animation.easeOut(duration: HazelTheme.duration["normal"] ?? 0.2)
                if let key = args.object?["key"]?.string {
                    withAnimation(animation) { proxy.scrollTo(RowKey(key), anchor: row ? .leading : .top) }
                    return .null
                }
                guard let to = args.object?["to"]?.string else { throw CommandError("scrollTo: needs {to: start|end} or {key}") }
                withAnimation(animation) {
                    proxy.scrollTo(to == "end" ? Self.end : Self.start, anchor: to == "end" ? (row ? .trailing : .bottom) : (row ? .leading : .top))
                }
                return .null
            }
        }
        .hzFillWidth(!inRow && !row)
    }

    static let start = "hz-scroll-start", end = "hz-scroll-end"

    @ViewBuilder private func content(_ row: Bool) -> some View {
        if row {
            HStack(spacing: 0) {
                Color.clear.frame(width: 0, height: 0).id(Self.start)
                ChildrenView(tree: tree, node: node)
                Color.clear.frame(width: 0, height: 0).id(Self.end)
            }
            .environment(\.hzInRow, true)
        } else {
            VStack(alignment: .leading, spacing: 0) {
                Color.clear.frame(width: 0, height: 0).id(Self.start)
                ChildrenView(tree: tree, node: node).frame(maxWidth: .infinity, alignment: .leading)
                Color.clear.frame(width: 0, height: 0).id(Self.end)
            }
            .environment(\.hzInRow, false)
        }
    }
}
