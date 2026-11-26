import SwiftUI

// Owned by lane S1 (`docs/hazel-ui.md`, "Phase 2: lanes"). A flex column or row: its recipe's gap
// between children; `stretch` (the default) widens each child of a column to the column's width.
struct HzStack: View {
    let tree: Tree
    let node: Node
    @Environment(\.horizontalSizeClass) private var horizontal
    @Environment(\.hzInRow) private var inRow

    var body: some View {
        let _ = RenderCounter.record(node.id)
        let sizeClass = HazelTheme.SizeClass(horizontal)
        let options = node.options(["axis", "density", "align"])
        let style = HazelTheme.Recipes.stack.style(options: options, sizeClass: sizeClass)
        // HAZEL-GAP(recipe-align-end): the recipe's `align` has no `end`; drawn here, as the web does.
        let align = options["align"] ?? "stretch"
        if style.layout == .row {
            HStack(alignment: Self.vertical(align), spacing: style.gap ?? 0) {
                ChildrenView(tree: tree, node: node)
            }
            .environment(\.hzInRow, true)
            .hzFillWidth(!inRow)
        } else {
            VStack(alignment: Self.horizontal(align), spacing: style.rowGap ?? 0) {
                ChildrenView(tree: tree, node: node).hzFillWidth(align == "stretch")
            }
            .environment(\.hzInRow, false)
            .hzFillWidth(!inRow, alignment: Self.frameAlignment(align))
        }
    }

    static func horizontal(_ align: String) -> HorizontalAlignment {
        switch align {
        case "center": .center
        case "end": .trailing
        default: .leading
        }
    }

    static func frameAlignment(_ align: String) -> Alignment {
        switch align {
        case "center": .center
        case "end": .trailing
        default: .leading
        }
    }

    static func vertical(_ align: String) -> VerticalAlignment {
        switch align {
        case "center": .center
        case "end": .bottom
        default: .top
        }
    }
}
