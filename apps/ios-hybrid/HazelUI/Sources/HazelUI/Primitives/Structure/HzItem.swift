import SwiftUI

// Owned by lane S4. `hz:item`: a sidebar row drawn from its recipe (`Recipes.item`): an unread mark,
// leading slot, title over an optional subtitle, badge, trailing slot, then the `actions` slot.
// A press raises `press`, a hold `longPress`.
//
// The row is not a `Button`: controls in `trailing` and `actions` stay their own buttons and their own
// accessibility elements (`item-trailing-control-ios`), and the row's text is one element that presses.
// iOS has no hover, so `actions` always shows (`item-hover-trailing`): after `trailing` on a regular
// row, in its own column centred on a large one; no swipe, the long press already opens the row's menu.
struct HzItem: View {
    let tree: Tree
    let node: Node

    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @Environment(\.hzScrollProxy) private var scrollProxy
    @State private var hovering = false
    @State private var pressing = false

    var body: some View {
        let _ = RenderCounter.record(node.id)
        let disabled = node[prop: "disabled"]?.bool == true
        ItemRow(tree: tree, node: node, sizeClass: HazelTheme.SizeClass(horizontalSizeClass),
                interaction: interactionStates(pressed: pressing, hovering: hovering), press: press)
            .contentShape(Rectangle())
            .onHover { hovering = $0 }
            .onTapGesture { if !disabled { press() } }
            .onLongPressGesture(minimumDuration: 0.5) {
                guard node.events.contains("longPress"), !disabled else { return }
                tree.fire(node.id, "longPress")
            } onPressingChanged: { pressing = $0 && !disabled }
            .disabled(disabled)
            .accessibilityElement(children: .contain)
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

    private func press() { tree.fire(node.id, "press") }
}

/// The row's look for one interaction state. Reads the node's props; slots and children are their
/// own views, so a child change never redraws the row.
private struct ItemRow: View {
    let tree: Tree
    let node: Node
    let sizeClass: HazelTheme.SizeClass
    let interaction: Set<HazelTheme.State>
    let press: () -> Void

    private var recipe: HazelTheme.Recipe { HazelTheme.Recipes.item }
    private var nested: String { node[prop: "nested"]?.string ?? "none" }
    private var unread: String { node[prop: "unread"]?.string ?? "none" }
    private var leadingSize: String { node[prop: "leadingSize"]?.string ?? "regular" }
    /// `large` and `conversation` share the row's layout; `conversation` moves its metrics.
    private var large: Bool { leadingSize != "regular" }
    private var conversation: Bool { leadingSize == "conversation" }

    private func style(_ part: String) -> HazelTheme.Style {
        let options = ["nested": nested, "leadingSize": leadingSize,
                       "titleLines": node[prop: "titleLines"]?.string ?? "1",
                       "subtitleLines": node[prop: "subtitleLines"]?.string ?? "1"]
        let flags: Set<String> = node[prop: "muted"]?.bool == true ? ["muted"] : []
        return recipe.style(part: part, options: options, flags: flags, states: interaction.union(viewStates),
                            sizeClass: sizeClass)
    }

    var body: some View {
        let control = style("control")
        Group {
            if large { largeRow(control) } else { regularRow(control) }
        }
        .hzBox(control)
        .overlay(alignment: .leading) { if unread == "pip" { UnreadPip() } }
        .overlay(alignment: .bottomLeading) { if nested != "none" { ThreadElbow(last: nested == "last") } }
        .padding(.leading, nested == "none" ? 0 : ThreadElbow.indent)
    }

    /// The sidebar row: one line of slots and text, centred.
    private func regularRow(_ control: HazelTheme.Style) -> some View {
        HStack(spacing: control.gap ?? 0) {
            HStack(spacing: control.gap ?? 0) {
                if unread == "dot" { UnreadDot() }
                ItemSlot(tree: tree, node: node, name: "leading", style: style("leading"))
                ChildrenView(tree: tree, node: node)
                VStack(alignment: .leading, spacing: 0) {
                    lines("title", control)
                    lines("subtitle", control)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                badge
            }
            .modifier(RowLabel(node: node, unread: unread, press: press))
            ItemSlot(tree: tree, node: node, name: "trailing", style: style("trailing"))
            ItemSlot(tree: tree, node: node, name: "actions", style: style("trailing"))
        }
    }

    /// `leadingSize` `large` (today's activity row): the dot's column, a 40pt leading column top
    /// aligned, the trailing slot on the title's line, the subtitle and badge under both.
    /// `conversation` (today's DM row): the avatar 2pt down, the time on the title's baseline.
    private func largeRow(_ control: HazelTheme.Style) -> some View {
        let space = { (step: String) in HazelTheme.space[step] ?? 0 }
        let hasActions = tree.slot("actions", of: node) != nil
        // The row's text is one element; a control in `trailing` stays its own, so then only the title is.
        let ownTrailing = tree.slot("trailing", of: node).map { hasControl($0) } ?? false
        let label = RowLabel(node: node, unread: unread, press: press)
        return HStack(alignment: .center, spacing: 0) {
            HStack(alignment: .top, spacing: 0) {
                if dotColumn {
                    ZStack { if unread == "dot" { UnreadDot() } }
                        .frame(width: space("2"), height: space("10"))
                        .padding(.trailing, space("3"))
                }
                ItemSlot(tree: tree, node: node, name: "leading", style: HazelTheme.Style())
                    .padding(.top, conversation ? space("0.5") : 0)
                    .padding(.trailing, space("3"))
                    .accessibilityHidden(ownTrailing)
                VStack(alignment: .leading, spacing: 0) {
                    HStack(alignment: conversation ? .firstTextBaseline : .top, spacing: 0) {
                        lines("title", control)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .modifier(OptionalLabel(label: ownTrailing ? label : nil))
                        ItemSlot(tree: tree, node: node, name: "trailing", style: style("trailing"))
                            .padding(.leading, space("2"))
                    }
                    HStack(alignment: .top, spacing: 0) {
                        lines("subtitle", control).frame(maxWidth: .infinity, alignment: .leading)
                        badge.padding(.leading, space("2")).padding(.top, conversation ? space("0.5") : 0)
                    }
                    .padding(.top, node[prop: "subtitle"]?.string?.isEmpty == false ? space("0.5") : 0)
                    .accessibilityHidden(ownTrailing)
                }
            }
            // The row's minimum: 6pt more than the 40pt column, as today's 16/24 line box makes it
            // (a conversation's column starts 2pt down).
            .frame(minHeight: space("10") + space("1.5") + (conversation ? space("0.5") : 0), alignment: .top)
            .modifier(OptionalLabel(label: ownTrailing ? nil : label))
            // With actions the row's end padding is 12pt, the actions' column 16pt from the text.
            ItemSlot(tree: tree, node: node, name: "actions", style: style("trailing"))
                .padding(.leading, space("4"))
                .padding(.trailing, hasActions ? space("3") - space("4") : 0)
        }
    }

    /// A large row beside a dotted one keeps the dot's column, so the avatars line up.
    private var dotColumn: Bool {
        if unread == "dot" { return true }
        guard let parent = node.parent.flatMap(tree.node) else { return false }
        return parent.children.contains { id in
            guard let row = tree.node(id), row.tag == "hz:item" else { return false }
            return row[prop: "unread"]?.string == "dot" && row[prop: "leadingSize"]?.string == "large"
        }
    }

    /// Whether a slot holds a control, which stays its own accessibility element.
    private func hasControl(_ slot: Node) -> Bool {
        slot.children.contains { id in
            guard let child = tree.node(id) else { return false }
            return Self.controls.contains(child.tag) || hasControl(child)
        }
    }

    private static let controls: Set<String> = [
        "hz:button", "hz:link", "hz:toggle", "hz:select", "hz:textField", "hz:menu", "hz:contextMenu",
    ]

    /// The title or subtitle: one truncated line, or its recipe's `lineClamp` lines.
    @ViewBuilder private func lines(_ part: String, _ control: HazelTheme.Style) -> some View {
        let text = node[prop: part]?.string ?? ""
        let own = style(part)
        if part == "title" || !text.isEmpty {
            if let clamp = own.lineClamp, clamp > 1 {
                Text(text)
                    .hzParagraph(Self.wrapping(control.merged(own)), sizeClass)
                    .fixedSize(horizontal: false, vertical: true)
                    .opacity(own.opacity ?? 1)
            } else {
                Text(text).lineLimit(1).hzText(control.merged(own), sizeClass).opacity(own.opacity ?? 1)
            }
        }
    }

    /// A clamped style wraps: its `truncate` gives way to `lineClamp`.
    private static func wrapping(_ style: HazelTheme.Style) -> HazelTheme.Style {
        var out = style
        out.truncate = nil
        return out
    }

    @ViewBuilder private var badge: some View {
        let count = Int(node[prop: "badge"]?.number ?? 0)
        if count > 0 {
            let badge = style("badge")
            Text(String(count)).lineLimit(1).fixedSize().hzText(badge, sizeClass).hzBox(badge)
        }
    }

    /// The view states the props set: `selected`, `emphasized`, `disabled`; and `linked` with an `href`.
    private var viewStates: Set<HazelTheme.State> {
        let flags: [(String, HazelTheme.State)] = [("selected", .selected), ("emphasized", .emphasized), ("disabled", .disabled)]
        let linked: Set<HazelTheme.State> = node[prop: "href"]?.string != nil ? [.linked] : []
        return Set(flags.filter { node[prop: $0.0]?.bool == true }.map(\.1)).union(linked)
    }
}

/// The row's own accessibility element: its title (with today's unread words) as a button that presses.
private struct RowLabel: ViewModifier {
    let node: Node
    let unread: String
    let press: () -> Void

    func body(content: Content) -> some View {
        let title = node[prop: "title"]?.string ?? ""
        let label = switch unread {
        case "dot": "Unread: \(title)"
        case "pip": "\(title), unread"
        default: title
        }
        content
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(label)
            .accessibilityValue(node[prop: "subtitle"]?.string ?? "")
            .accessibilityAddTraits(node[prop: "selected"]?.bool == true ? [.isButton, .isSelected] : .isButton)
            .accessibilityAction { press() }
    }
}

/// `RowLabel` when given, else the content as it is.
private struct OptionalLabel: ViewModifier {
    let label: RowLabel?

    func body(content: Content) -> some View {
        if let label { content.modifier(label) } else { content }
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

/// `unread` `dot`: activity's brand dot in its own 8pt column.
private struct UnreadDot: View {
    var body: some View {
        let side = HazelTheme.space["2"] ?? 0
        Circle().fill(HazelTheme.Colors.primary.color).frame(width: side, height: side)
            .accessibilityHidden(true)
    }
}

/// `unread` `pip` (`sidebarUnreadPip`): a 4 by 8pt bar on the row's leading edge, rounded at its end.
private struct UnreadPip: View {
    var body: some View {
        let full = HazelTheme.radius["full"] ?? 0
        UnevenRoundedRectangle(bottomTrailingRadius: full, topTrailingRadius: full)
            .fill(HazelTheme.Colors.fg.color)
            .frame(width: HazelTheme.space["1"] ?? 0, height: HazelTheme.space["2"] ?? 0)
            .allowsHitTesting(false)
            .accessibilityHidden(true)
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
