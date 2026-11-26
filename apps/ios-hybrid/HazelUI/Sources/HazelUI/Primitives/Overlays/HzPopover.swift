import SwiftUI

// `hz:popover` on iOS (lane S3): a system popover (kept a popover on iPhone too) attached to the
// `anchor` slot, or to the popover's own place when there is none. An outside tap raises `dismiss`.
// HAZEL-GAP(popover-anchor-run): `anchorTo` names a run inside a leaf; no leaf exposes run frames.
struct HzPopover: View {
    let tree: Tree
    let node: Node
    @Environment(\.horizontalSizeClass) private var horizontal

    var body: some View {
        let sizeClass = HazelTheme.SizeClass(horizontal)
        let panel = HazelTheme.Recipes.popover.style(part: "panel", sizeClass: sizeClass)
        let open = node[prop: "open"]?.bool == true
        if node.overlayInPlace {
            VStack(alignment: .leading, spacing: HazelTheme.space["1"] ?? 0) {
                SlotView(tree: tree, node: node, name: "anchor")
                if open { PopoverBody(tree: tree, node: node, style: panel).hzOverlayPanel(panel) }
            }
        } else {
            anchor
                .popover(isPresented: overlayDismissBinding(tree, node, node[prop: "open"]?.bool == true), attachmentAnchor: .rect(.bounds)) {
                    PopoverBody(tree: tree, node: node, style: panel)
                        .hzBox(panel.merged(HazelTheme.Style(background: HazelTheme.Colors.clear, radius: 0)))
                        .presentationCompactAdaptation(.popover)
                        .presentationBackground(HazelTheme.Colors.bg.color)
                }
        }
    }

    @ViewBuilder private var anchor: some View {
        if tree.slot("anchor", of: node) != nil {
            SlotView(tree: tree, node: node, name: "anchor")
        } else {
            Color.clear.frame(width: 1, height: 1)
        }
    }
}

private struct PopoverBody: View {
    let tree: Tree
    let node: Node
    let style: HazelTheme.Style

    var body: some View {
        VStack(alignment: .leading, spacing: style.rowGap ?? 0) { ChildrenView(tree: tree, node: node) }
    }
}
