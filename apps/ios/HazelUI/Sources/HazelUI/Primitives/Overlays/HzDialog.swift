import SwiftUI

// `hz:dialog` on iOS (lane S3). With no children it is the system's own: an alert, or a confirmation
// dialog when `destructive`, whose buttons are the `actions` slot's buttons and actions (a press fires
// theirs). With children it is a fitted form sheet drawing the panel. Dismissing raises `dismiss`.
// Presented, the system's own transitions play; the recipe's `riseIn`/`scaleIn` play in place.
struct HzDialog: View {
    let tree: Tree
    let node: Node
    @Environment(\.horizontalSizeClass) private var horizontal
    /// Set when one of the system buttons was pressed, so its closing is not also a `dismiss`.
    @State private var pressed = false

    /// The web's renderer-owned 28rem (`focus/surface.ts`): a dialog never spans a wide screen.
    private static let maxWidth: CGFloat = 448

    var body: some View {
        let sizeClass = HazelTheme.SizeClass(horizontal)
        let panel = HazelTheme.Recipes.dialog.style(part: "panel", sizeClass: sizeClass)
        if node.overlayInPlace {
            if node[prop: "open"]?.bool == true {
                // A phone's dialog rises in, a wide screen's scales in (`regular`); the scrim fades.
                DialogBody(tree: tree, node: node, sizeClass: sizeClass)
                    .hzOverlayPanel(panel)
                    .hzEnter("dialog", part: "panel", sizeClass: sizeClass)
                    .frame(maxWidth: Self.maxWidth)
                    .padding(HazelTheme.space["6"] ?? 0)
                    .frame(maxWidth: .infinity)
                    .hzOverlayScrim("dialog", sizeClass)
            }
        } else if tree.content(of: node).isEmpty {
            systemDialog
        } else {
            Color.clear.frame(width: 0, height: 0)
                .sheet(isPresented: overlayDismissBinding(tree, node, node[prop: "open"]?.bool == true)) {
                    DialogBody(tree: tree, node: node, sizeClass: sizeClass)
                        .hzBox(panel.merged(HazelTheme.Style(background: HazelTheme.Colors.clear, radius: 0)))
                        .presentationSizing(.form.fitted(horizontal: false, vertical: true))
                        .presentationBackground(HazelTheme.Colors.bg.color)
                }
        }
    }

    @ViewBuilder private var systemDialog: some View {
        let title = node.overlayText("title") ?? ""
        let open = node[prop: "open"]?.bool == true
        let isPresented = Binding(
            get: { open },
            set: { open in
                guard !open else { return }
                if pressed { pressed = false } else { tree.fire(node.id, "dismiss") }
            }
        )
        let actions = SystemActions(tree: tree, node: node, destructive: node[prop: "destructive"]?.bool == true) { pressed = true }
        let message = node.overlayText("description")
        if node[prop: "destructive"]?.bool == true {
            Color.clear.frame(width: 0, height: 0)
                .confirmationDialog(title, isPresented: isPresented, titleVisibility: .visible) { actions } message: {
                    if let message { Text(message) }
                }
        } else {
            Color.clear.frame(width: 0, height: 0)
                .alert(title, isPresented: isPresented) { actions } message: {
                    if let message { Text(message) }
                }
        }
    }
}

/// The `actions` slot as system buttons: a `danger` button is destructive and, in a destructive
/// dialog, the first other one is the cancel. A press fires the node's own `press`.
private struct SystemActions: View {
    let tree: Tree
    let node: Node
    let destructive: Bool
    let onPress: () -> Void

    var body: some View {
        let nodes = tree.slot("actions", of: node).map { tree.content(of: $0) } ?? []
        let cancel = destructive ? nodes.first { $0[prop: "variant"]?.string != "danger" }?.id : nil
        ForEach(nodes, id: \.id) { action in
            let label = action.overlayText("label") ?? tree.text(of: action)
            let role: ButtonRole? = action[prop: "variant"]?.string == "danger" ? .destructive : (action.id == cancel ? .cancel : nil)
            Button(label, role: role) {
                onPress()
                tree.fire(action.id, "press")
            }
        }
    }
}

/// The dialog's panel: title and description, the children, then the actions at the end edge.
private struct DialogBody: View {
    let tree: Tree
    let node: Node
    let sizeClass: HazelTheme.SizeClass

    var body: some View {
        let recipe = HazelTheme.Recipes.dialog
        let states: Set<HazelTheme.State> = node[prop: "destructive"]?.bool == true ? [.destructive] : []
        let panel = recipe.style(part: "panel", sizeClass: sizeClass)
        let header = recipe.style(part: "header", sizeClass: sizeClass)
        let content = recipe.style(part: "content", sizeClass: sizeClass)
        let actions = recipe.style(part: "actions", sizeClass: sizeClass)
        VStack(alignment: .leading, spacing: panel.rowGap ?? 0) {
            VStack(alignment: .leading, spacing: header.rowGap ?? 0) {
                if let title = node.overlayText("title") {
                    Text(title).hzText(recipe.style(part: "title", states: states, sizeClass: sizeClass), sizeClass)
                        .accessibilityAddTraits(.isHeader)
                }
                if let description = node.overlayText("description") {
                    Text(description).hzText(recipe.style(part: "description", sizeClass: sizeClass), sizeClass)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            if !tree.content(of: node).isEmpty {
                VStack(alignment: .leading, spacing: content.rowGap ?? 0) { ChildrenView(tree: tree, node: node) }
            }
            if tree.slot("actions", of: node) != nil {
                HStack(spacing: actions.gap ?? 0) {
                    Spacer(minLength: 0)
                    SlotView(tree: tree, node: node, name: "actions")
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
