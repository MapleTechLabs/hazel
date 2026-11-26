import SwiftUI

// `hz:sheet` on iOS (lane S3): a system sheet, with medium and large detents in the compact size class
// and a form sheet in the regular one. Its title row has a close button; it and a swipe down raise
// `dismiss`, and the sheet closes when the view sets `open` false. In place it draws the panel.
struct HzSheet: View {
    let tree: Tree
    let node: Node
    @Environment(\.horizontalSizeClass) private var horizontal

    var body: some View {
        let sizeClass = HazelTheme.SizeClass(horizontal)
        if node.overlayInPlace {
            if node[prop: "open"]?.bool == true {
                VStack(spacing: 0) {
                    Spacer(minLength: HazelTheme.space["6"] ?? 0)
                    SheetBody(tree: tree, node: node, sizeClass: sizeClass)
                        .hzOverlayPanel(HazelTheme.Recipes.sheet.style(part: "panel", sizeClass: sizeClass))
                }
                .frame(maxWidth: .infinity)
                .hzOverlayScrim()
            }
        } else {
            Color.clear.frame(width: 0, height: 0)
                .sheet(isPresented: overlayDismissBinding(tree, node, node[prop: "open"]?.bool == true)) {
                    ScrollView {
                        SheetBody(tree: tree, node: node, sizeClass: sizeClass).hzBox(
                            HazelTheme.Recipes.sheet.style(part: "panel", sizeClass: sizeClass)
                                .merged(HazelTheme.Style(background: HazelTheme.Colors.clear, radius: 0))
                        )
                    }
                    .presentationDetents(sizeClass == .compact ? [.medium, .large] : [.large])
                    .presentationSizing(.form)
                    .presentationDragIndicator(.visible)
                    .presentationBackground(HazelTheme.Colors.bg.color)
                }
        }
    }
}

/// The title row and the children, as the sheet's panel lays them out.
private struct SheetBody: View {
    let tree: Tree
    let node: Node
    let sizeClass: HazelTheme.SizeClass

    var body: some View {
        let recipe = HazelTheme.Recipes.sheet
        let panel = recipe.style(part: "panel", sizeClass: sizeClass)
        let header = recipe.style(part: "header", sizeClass: sizeClass)
        let title = recipe.style(part: "title", sizeClass: sizeClass)
        let content = recipe.style(part: "content", sizeClass: sizeClass)
        VStack(alignment: .leading, spacing: panel.rowGap ?? 0) {
            HStack(spacing: header.gap ?? 0) {
                if let text = node.overlayText("title") {
                    Text(text).hzText(title, sizeClass).lineLimit(1).accessibilityAddTraits(.isHeader)
                }
                Spacer(minLength: 0)
                OverlayCloseButton(style: recipe.style(part: "close", sizeClass: sizeClass), label: "Close") {
                    tree.fire(node.id, "dismiss")
                }
            }
            VStack(alignment: .leading, spacing: content.rowGap ?? 0) { ChildrenView(tree: tree, node: node) }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
