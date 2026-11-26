import SwiftUI

// `hz:tooltip` on iOS (lane S3): iOS has no tooltips, so the label is the children's `help`: a
// pointer hover tooltip on iPad and Mac, and the accessibility hint VoiceOver reads everywhere.
// Nothing else is drawn, in place or not; a long press stays free for context menus.
struct HzTooltip: View {
    let tree: Tree
    let node: Node

    var body: some View {
        let label = node.overlayText("label") ?? ""
        VStack(alignment: .leading, spacing: 0) { ChildrenView(tree: tree, node: node) }
            .help(label)
    }
}
