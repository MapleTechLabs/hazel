import SwiftUI

// Owned by lane S1 (`docs/hazel-ui.md`, "Phase 2: lanes"). Scrolls along its axis when its content
// overflows; content that fits is drawn as is (the web's `overflow: auto`). Answers `scrollTo` edges.
struct HzScroll: View {
    let tree: Tree
    let node: Node
    @Environment(\.horizontalSizeClass) private var horizontal
    @Environment(\.hzInRow) private var inRow

    var body: some View {
        let _ = RenderCounter.record(node.id)
        let axis = node[prop: "axis"]?.string
        let style = HazelTheme.Recipes.scroll.style(options: axis.map { ["axis": $0] } ?? [:], sizeClass: HazelTheme.SizeClass(horizontal))
        let row = style.layout == .row
        let tree = tree, node = node
        ScrollViewReader { proxy in
            ViewThatFits(in: row ? .horizontal : .vertical) {
                content(row)
                ScrollView(row ? .horizontal : .vertical) { content(row) }
            }
            .hazelCommands(tree, node) { name, args in
                guard name == .scrollTo else { throw CommandError("scroll does not handle \(name.rawValue)") }
                // HAZEL-GAP(row-key): keys never reach the host, so only edges can be targeted.
                guard let to = args.object?["to"]?.string else { throw CommandError("scrollTo: only {to: start|end} reaches the host") }
                withAnimation(.easeOut(duration: HazelTheme.duration["normal"] ?? 0.2)) {
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
