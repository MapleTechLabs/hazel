import SwiftUI
import HazelUI

/// Typed props per `hz:*` tag, read from what crossed the wire (codegen writes these in phase 1).
struct ScreenProps { let title: String
    init(_ p: [String: JSONValue]) { title = p["title"]?.string ?? "" } }
struct SectionProps { let title: String
    init(_ p: [String: JSONValue]) { title = p["title"]?.string ?? "" } }
struct ItemProps {
    let title: String, badge: Int, emphasized: Bool, selected: Bool, href: String?
    init(_ p: [String: JSONValue]) {
        title = p["title"]?.string ?? ""
        badge = Int(p["badge"]?.number ?? 0)
        emphasized = p["emphasized"]?.bool ?? false
        selected = p["selected"]?.bool ?? false
        href = p["href"]?.string
    }

    /// The recipe states this row is in (the host adds `pressed`).
    var states: Set<HazelTheme.State> {
        var states: Set<HazelTheme.State> = []
        if selected { states.insert(.selected) }
        if emphasized { states.insert(.emphasized) }
        return states
    }
}
struct TextProps {
    let role: String, tone: String, strong: Bool
    init(_ p: [String: JSONValue]) {
        role = p["role"]?.string ?? "body"
        tone = p["tone"]?.string ?? "default"
        strong = p["strong"]?.bool ?? false
    }
}
struct ExtProps { let name: String, args: [String: JSONValue]
    init(_ p: [String: JSONValue]) { name = p["ext"]?.string ?? ""; args = p["args"]?.object ?? [:] } }

private typealias Recipes = HazelTheme.Recipes

/// Draws one `hazel` node from the generated recipes (`HazelTheme`). Tags this build does not know draw nothing.
struct HzView: View {
    let node: HzNode
    let runtime: EffectUiRuntime

    var body: some View {
        switch node.tag {
        case "hz:screen": HzScreen(node: node, runtime: runtime)
        case "hz:section": HzSection(node: node, runtime: runtime)
        case "hz:item": HzItem(node: node, runtime: runtime)
        case "hz:text": HzText(node: node)
        case "hz:icon": Theme.icon(node.props["name"]?.string ?? "").resizable()
        case "hz:avatar": HzAvatar(initials: node.props["initials"]?.string ?? "")
        case "hz:slot": ForEach(node.children) { HzView(node: $0, runtime: runtime) }
        case "hz:ext": HzExtension(node: node, runtime: runtime)
        case "hz:textField": HzTextField(node: node, runtime: runtime)
        default: EmptyView()
        }
    }
}

/// A press-driven control: the style draws the whole label, so recipes can read `pressed`.
private struct Pressable<Label: View>: ButtonStyle {
    let label: (_ pressed: Bool) -> Label
    init(@ViewBuilder _ label: @escaping (_ pressed: Bool) -> Label) { self.label = label }
    func makeBody(configuration: Configuration) -> some View { label(configuration.isPressed) }
}

struct HzScreen: View {
    let node: HzNode
    let runtime: EffectUiRuntime
    @Environment(\.horizontalSizeClass) private var horizontal

    var body: some View {
        let sizeClass = HazelTheme.SizeClass(horizontal)
        let style = { (part: String?) in Recipes.screen.style(part: part, sizeClass: sizeClass) }
        VStack(spacing: 0) {
            Text(ScreenProps(node.props).title)
                .hzText(style("title"), sizeClass)
                .opacity(style("title").opacity ?? 1)
                .frame(maxWidth: .infinity, alignment: .leading)
                .hzBox(style("header"))
            ScrollView {
                VStack(spacing: style("content").rowGap ?? 0) {
                    ForEach(node.content) { HzView(node: $0, runtime: runtime) }
                    HzStats(tree: runtime.tree)
                }
                .hzBox(style("content"))
            }
        }
        .background(style(nil).background?.color ?? .clear)
    }
}

/// A section: its title and header actions on one row, then each item on a row of its own.
struct HzSection: View {
    let node: HzNode
    let runtime: EffectUiRuntime
    @Environment(\.horizontalSizeClass) private var horizontal

    var body: some View {
        let sizeClass = HazelTheme.SizeClass(horizontal)
        let root = Recipes.section.style(sizeClass: sizeClass)
        let title = Recipes.section.style(part: "title", sizeClass: sizeClass)
        let actions = node.content.filter { $0.tag == "hz:action" }
        VStack(alignment: .leading, spacing: root.rowGap ?? 0) {
            HStack(spacing: 0) {
                Text(SectionProps(node.props).title)
                    .hzText(title, sizeClass)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .hzBox(title)
                    .padding(.bottom, title.marginBottom ?? 0)
                ForEach(actions) { HzAction(node: $0, runtime: runtime) }
            }
            ForEach(node.content.filter { $0.tag != "hz:action" }) { HzView(node: $0, runtime: runtime) }
        }
        .hzBox(root)
    }
}

/// A section's header action: a square button around its icon.
struct HzAction: View {
    let node: HzNode
    let runtime: EffectUiRuntime
    @Environment(\.horizontalSizeClass) private var horizontal

    var body: some View {
        let sizeClass = HazelTheme.SizeClass(horizontal)
        Button { runtime.fire(node.id) } label: { EmptyView() }
            .buttonStyle(Pressable { pressed in
                let states: Set<HazelTheme.State> = pressed ? [.pressed] : []
                let root = Recipes.action.style(states: states, sizeClass: sizeClass)
                let icon = Recipes.action.style(part: "icon", states: states, sizeClass: sizeClass)
                ForEach(node.children) { HzView(node: $0, runtime: runtime).hzSize(icon) }
                    .foregroundStyle(root.color?.color ?? .primary)
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .hzSize(root)
                    .hzBox(root)
            })
            .accessibilityLabel(node.props["label"]?.string ?? "")
    }
}

/// A row: natively always a button; `href` (link vs button on the web) only adds the link trait.
struct HzItem: View {
    let node: HzNode
    let runtime: EffectUiRuntime
    @Environment(\.horizontalSizeClass) private var horizontal

    var body: some View {
        let item = ItemProps(node.props)
        let sizeClass = HazelTheme.SizeClass(horizontal)
        Button { runtime.fire(node.id) } label: { EmptyView() }
            .buttonStyle(Pressable { pressed in
                let states = pressed ? item.states.union([.pressed]) : item.states
                let style = { (part: String) in Recipes.item.style(part: part, states: states, sizeClass: sizeClass) }
                let control = style("control")
                HStack(spacing: control.gap ?? 0) {
                    if let leading = node.slot("leading") {
                        let slot = style("leading")
                        ForEach(leading.children) { HzView(node: $0, runtime: runtime) }
                            .hzSize(slot)
                            .foregroundStyle(slot.color?.color ?? .primary)
                    }
                    Text(item.title)
                        .hzText(control.merged(style("title")), sizeClass)
                        .lineLimit(1)
                        .truncationMode(.tail)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    if item.badge > 0 {
                        let badge = style("badge")
                        Text("\(item.badge)")
                            .hzText(badge, sizeClass)
                            .hzBox(badge)
                    }
                }
                .hzBox(control)
            })
            .accessibilityLabel(item.title)
            .accessibilityAddTraits(item.href == nil ? [] : .isLink)
            .accessibilityAddTraits(item.selected ? .isSelected : [])
    }
}

struct HzText: View {
    let node: HzNode
    @Environment(\.horizontalSizeClass) private var horizontal

    var body: some View {
        let text = TextProps(node.props)
        let sizeClass = HazelTheme.SizeClass(horizontal)
        let style = Recipes.text.style(
            options: ["role": text.role, "tone": text.tone],
            flags: text.strong ? ["strong"] : [],
            sizeClass: sizeClass
        )
        Text(node.joinedText)
            .hzText(style, sizeClass)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct HzAvatar: View {
    let initials: String
    @Environment(\.horizontalSizeClass) private var horizontal

    var body: some View {
        let sizeClass = HazelTheme.SizeClass(horizontal)
        let style = Recipes.avatar.style(sizeClass: sizeClass)
        Text(initials)
            .font(style.font(sizeClass))
            .foregroundStyle(style.color?.color ?? .primary)
            .hzSize(style)
            .background(Circle().fill(style.background?.color ?? .clear))
    }
}

/// An `hz:ext` placeholder: the registered native view if iOS implements it, else its fallback slot.
struct HzExtension: View {
    let node: HzNode
    let runtime: EffectUiRuntime
    @Environment(\.horizontalSizeClass) private var horizontal

    var body: some View {
        let ext = ExtProps(node.props)
        let sizeClass = HazelTheme.SizeClass(horizontal)
        let root = Recipes.ext.style(sizeClass: sizeClass)
        Group {
            if let draw = HazelExtensions.registry[ext.name] {
                draw(ext.args) { event, payload in runtime.fire(node.id, event, payload: payload) }
            } else if let fallback = node.slot("fallback") {
                HzView(node: fallback, runtime: runtime)
                    .hzBox(Recipes.ext.style(part: "content", sizeClass: sizeClass))
            }
        }
        .padding(.horizontal, root.marginX ?? 0)
        .padding(.bottom, root.marginBottom ?? 0)
    }
}

/// What the last batch cost, so the numbers are in the screenshot.
struct HzStats: View {
    let tree: EffectUiTree
    var body: some View {
        Text("wire v\(WIRE_VERSION) · \(tree.batches) batches · last \(tree.lastOps) ops, \(tree.lastBytes) B, \(String(format: "%.2f", tree.lastApplyMs)) ms")
            .font(Inter.font(size: 12, weight: 400))
            .foregroundStyle(HazelTheme.Colors.mutedFg.color)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 24)
            .padding(.vertical, 16)
    }
}
