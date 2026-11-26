import SwiftUI

// Owned by lane S4. `hz:item`: a sidebar row drawn from its recipe (`Recipes.item`): leading slot,
// title over an optional subtitle, badge, trailing slot. A press raises `press`, a hold `longPress`.
struct HzItem: View {
    let tree: Tree
    let node: Node

    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @Environment(\.hzScrollProxy) private var scrollProxy
    @State private var hovering = false
    @State private var heldDown = false

    var body: some View {
        let _ = RenderCounter.record(node.id)
        let disabled = node[prop: "disabled"]?.bool == true
        Button(action: press) { EmptyView() }
            .buttonStyle(PressStyle { pressed in
                ItemRow(tree: tree, node: node, sizeClass: HazelTheme.SizeClass(horizontalSizeClass),
                        interaction: interactionStates(pressed: pressed, hovering: hovering))
            })
            .disabled(disabled)
            .onHover { hovering = $0 }
            .simultaneousGesture(LongPressGesture().onEnded { _ in
                guard node.events.contains("longPress"), !disabled else { return }
                heldDown = true
                tree.fire(node.id, "longPress")
            })
            .accessibilityLabel(node[prop: "title"]?.string ?? "")
            .accessibilityAddTraits(node[prop: "selected"]?.bool == true ? .isSelected : [])
            .id(node.id)
            .hazelCommands(tree, node) { name, args in
                guard name == .scrollTo else { throw CommandError("hz:item does not handle \(name.rawValue)") }
                guard let scrollProxy else { throw CommandError("hz:item is not inside a screen's scroll view") }
                let anchor: UnitPoint? = switch args.object?["to"]?.string {
                case "start": .top
                case "end": .bottom
                default: nil
                }
                withAnimation { scrollProxy.scrollTo(node.id, anchor: anchor) }
                return .null
            }
    }

    private func press() {
        // The touch that ended a long press is not a press too.
        if heldDown {
            heldDown = false
            return
        }
        tree.fire(node.id, "press")
    }
}

/// The row's look for one interaction state. Reads the node's props; slots and children are their
/// own views, so a child change never redraws the row.
private struct ItemRow: View {
    let tree: Tree
    let node: Node
    let sizeClass: HazelTheme.SizeClass
    let interaction: Set<HazelTheme.State>

    var body: some View {
        let recipe = HazelTheme.Recipes.item
        let states = interaction.union(viewStates)
        let nested = node[prop: "nested"]?.string ?? "none"
        let flags: Set<String> = node[prop: "muted"]?.bool == true ? ["muted"] : []
        let style = { (part: String) in
            recipe.style(part: part, options: ["nested": nested], flags: flags, states: states, sizeClass: sizeClass)
        }
        let control = style("control"), leading = style("leading"), title = style("title")
        let subtitle = style("subtitle"), badge = style("badge"), trailing = style("trailing")
        let subtitleText = node[prop: "subtitle"]?.string ?? ""
        let count = Int(node[prop: "badge"]?.number ?? 0)

        HStack(spacing: control.gap ?? 0) {
            ItemSlot(tree: tree, node: node, name: "leading", style: leading)
            ChildrenView(tree: tree, node: node)
            VStack(alignment: .leading, spacing: 0) {
                Text(node[prop: "title"]?.string ?? "")
                    .lineLimit(1)
                    .hzText(control.merged(title), sizeClass)
                    .opacity(title.opacity ?? 1)
                if !subtitleText.isEmpty {
                    Text(subtitleText).lineLimit(1).hzText(control.merged(subtitle), sizeClass)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if count > 0 {
                Text(String(count)).lineLimit(1).fixedSize().hzText(badge, sizeClass).hzBox(badge)
            }
            ItemSlot(tree: tree, node: node, name: "trailing", style: trailing)
        }
        .hzBox(control)
        .overlay(alignment: .bottomLeading) { if nested != "none" { ThreadElbow(last: nested == "last") } }
        .padding(.leading, nested == "none" ? 0 : ThreadElbow.indent)
    }

    /// The view states the props set: `selected`, `emphasized`, `disabled`.
    private var viewStates: Set<HazelTheme.State> {
        let flags: [(String, HazelTheme.State)] = [("selected", .selected), ("emphasized", .emphasized), ("disabled", .disabled)]
        return Set(flags.filter { node[prop: $0.0]?.bool == true }.map(\.1))
    }
}

/// A row slot: drawn at the recipe part's size and ink only when the item has that slot.
private struct ItemSlot: View {
    let tree: Tree
    let node: Node
    let name: String
    let style: HazelTheme.Style

    var body: some View {
        if let slot = tree.slot(name, of: node) {
            HStack(spacing: style.gap ?? 0) { ChildrenView(tree: tree, node: slot) }
                .foregroundStyle(style.color?.color ?? Color.primary)
                .hzSize(style)
                .opacity(style.opacity ?? 1)
        }
    }
}

/// The thread elbow (`item.nested`), the web's `elbowOf` path: from the row's bottom edge the branch
/// eases off the spine into the row's middle. Geometry mirrors `web/primitives/structure/item.ts`.
private struct ThreadElbow: View {
    let last: Bool

    static let indent = (HazelTheme.space["6"] ?? 0) + (HazelTheme.space["0.5"] ?? 0)
    private static let width = HazelTheme.space["3"] ?? 0
    private static let height = HazelTheme.space["8"] ?? 0

    var body: some View {
        Path { path in
            let h = Self.height
            // Web coordinates are y up from the row's bottom; here y = h - webY.
            if last {
                path.move(to: CGPoint(x: 1.75, y: 0))
                path.addLine(to: CGPoint(x: 1.75, y: h - 27))
            } else {
                path.move(to: CGPoint(x: 1.75, y: h))
                path.addLine(to: CGPoint(x: 1.75, y: 0))
                path.move(to: CGPoint(x: 1.75, y: h - 27))
            }
            path.addCurve(to: CGPoint(x: 11, y: h - 16), control1: CGPoint(x: 1.75, y: h - 20), control2: CGPoint(x: 4, y: h - 16))
        }
        .stroke(HazelTheme.Colors.fg.color.opacity(0.15), style: StrokeStyle(lineWidth: 1.5, lineCap: .round))
        .frame(width: Self.width, height: Self.height)
        .clipped()
        .offset(x: -Self.width)
        .allowsHitTesting(false)
    }
}
