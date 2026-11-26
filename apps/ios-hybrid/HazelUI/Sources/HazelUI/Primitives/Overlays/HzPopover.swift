import SwiftUI

// `hz:popover` on iOS (lane S3): a system popover (kept a popover on iPhone too) attached to the
// run `anchorTo` names (a keyed leaf's run, from `RunAnchors`), else the `anchor` slot, else the
// popover's own place. An outside tap raises `dismiss`. Presented, the system popover's own
// transition plays; in place the recipe's `fadeIn`.
struct HzPopover: View {
    let tree: Tree
    let node: Node
    @Environment(\.horizontalSizeClass) private var horizontal
    /// The anchor view's frame on screen, so a run's global frame can be made local to it.
    @State private var origin: CGRect = .zero

    var body: some View {
        let sizeClass = HazelTheme.SizeClass(horizontal)
        let panel = HazelTheme.Recipes.popover.style(part: "panel", sizeClass: sizeClass)
        let open = node[prop: "open"]?.bool == true
        if node.overlayInPlace {
            // As the web's specimen: open, the anchor sits in the panel above the children.
            if open {
                VStack(alignment: .leading, spacing: panel.rowGap ?? 0) {
                    SlotView(tree: tree, node: node, name: "anchor")
                    PopoverBody(tree: tree, node: node, style: panel)
                }
                .hzOverlayPanel(panel)
                .hzEnter("popover", part: "panel", sizeClass: sizeClass)
            } else {
                SlotView(tree: tree, node: node, name: "anchor")
            }
        } else {
            anchor
                .onGeometryChange(for: CGRect.self, of: { $0.frame(in: .global) }) { origin = $0 }
                .popover(isPresented: overlayDismissBinding(tree, node, open), attachmentAnchor: attachment) {
                    PopoverBody(tree: tree, node: node, style: panel)
                        .hzBox(panel.merged(HazelTheme.Style(background: HazelTheme.Colors.clear, radius: 0)))
                        .presentationCompactAdaptation(.popover)
                        .presentationBackground(HazelTheme.Colors.bg.color)
                }
        }
    }

    /// The run `anchorTo` names (`{key, run}`) once its leaf has drawn, in the anchor view's space;
    /// else the anchor's bounds.
    private var attachment: PopoverAttachmentAnchor {
        let to = node[prop: "anchorTo"]?.object
        guard let key = to?["key"]?.string, let run = to?["run"]?.number,
              let frame = RunAnchors.shared.frame(key: key, run: Int(run))
        else { return .rect(.bounds) }
        return .rect(.rect(frame.offsetBy(dx: -origin.minX, dy: -origin.minY)))
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
