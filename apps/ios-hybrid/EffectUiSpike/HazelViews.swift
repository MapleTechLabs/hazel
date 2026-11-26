import SwiftUI

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

/// Draws one `hazel` node in Hazel's look (`Theme`). Tags this build does not know draw nothing.
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
        default: EmptyView()
        }
    }
}

struct HzScreen: View {
    let node: HzNode
    let runtime: EffectUiRuntime

    var body: some View {
        VStack(spacing: 0) {
            Text(ScreenProps(node.props).title)
                .font(Inter.font(size: 14, weight: 500))
                .foregroundStyle(Theme.Row.labelEmphasized.opacity(0.8))
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 24)
                .frame(height: 56)
                .overlay(alignment: .bottom) { Rectangle().fill(Theme.bandBorder).frame(height: 1) }
            ScrollView {
                LazyVStack(spacing: Theme.Section.spacing) {
                    ForEach(node.content) { HzView(node: $0, runtime: runtime) }
                    HzStats(tree: runtime.tree)
                }
                .padding(.horizontal, 16)
            }
        }
    }
}

struct HzSection: View {
    let node: HzNode
    let runtime: EffectUiRuntime

    var body: some View {
        let actions = node.content.filter { $0.tag == "hz:action" }
        VStack(spacing: Theme.Row.spacing) {
            HStack(spacing: 4) {
                Image("hazel.chevron-down")
                    .resizable()
                    .frame(width: Theme.Section.chevronSize, height: Theme.Section.chevronSize)
                Text(SectionProps(node.props).title).font(Theme.Section.font)
                Spacer()
                ForEach(actions) { action in
                    Button { runtime.fire(action.id) } label: {
                        ForEach(action.children) { HzView(node: $0, runtime: runtime) }
                            .frame(width: Theme.Section.actionSize, height: Theme.Section.actionSize)
                            .frame(width: 32, height: 32)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(action.props["label"]?.string ?? "")
                }
            }
            .foregroundStyle(Theme.Section.label)
            .padding(.leading, Theme.Section.chevronLeading)
            .frame(height: Theme.Section.headerHeight)
            .padding(.top, Theme.Section.padTop)
            ForEach(node.content.filter { $0.tag != "hz:action" }) { HzView(node: $0, runtime: runtime) }
        }
        .padding(.bottom, Theme.Section.padBottom)
    }
}

/// A row: natively always a button; `href` (link vs button on the web) only adds the link trait.
struct HzItem: View {
    let node: HzNode
    let runtime: EffectUiRuntime

    var body: some View {
        let item = ItemProps(node.props)
        let fg = item.selected ? Theme.Row.selectedFg : item.emphasized ? Theme.Row.labelEmphasized : Theme.Row.label
        Button { runtime.fire(node.id) } label: {
            HStack(spacing: Theme.Row.gap) {
                if let leading = node.slot("leading") {
                    ForEach(leading.children) { child in
                        HzView(node: child, runtime: runtime)
                            .frame(width: child.tag == "hz:avatar" ? Theme.Row.avatarSize : Theme.Row.iconSize,
                                   height: child.tag == "hz:avatar" ? Theme.Row.avatarSize : Theme.Row.iconSize)
                            .foregroundStyle(item.selected ? Theme.Row.selectedFg : Theme.Row.icon)
                    }
                }
                Text(item.title).font(Theme.Row.font).foregroundStyle(fg).lineLimit(1)
                Spacer(minLength: 0)
                if item.badge > 0 { HzBadge(count: item.badge) }
            }
            .padding(.leading, Theme.Row.padLeading)
            .padding(.trailing, Theme.Badge.trailing)
            .frame(height: Theme.Row.height)
            .background(RoundedRectangle(cornerRadius: Theme.Row.radius).fill(item.selected ? Theme.Row.selectedBg : .clear))
            .contentShape(RoundedRectangle(cornerRadius: Theme.Row.radius))
        }
        .buttonStyle(PressStyle())
        .accessibilityLabel(item.title)
        .accessibilityAddTraits(item.href == nil ? [] : .isLink)
        .accessibilityAddTraits(item.selected ? .isSelected : [])
    }
}

struct HzText: View {
    let node: HzNode

    var body: some View {
        let text = TextProps(node.props)
        let size: CGFloat = text.role == "caption" ? 12 : text.role == "title" ? 17 : 14
        Text(node.joinedText)
            .font(Inter.font(size: size, weight: text.strong ? 600 : 400))
            .foregroundStyle(text.tone == "muted" ? Theme.Section.label : Theme.Row.labelEmphasized)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

struct HzAvatar: View {
    let initials: String
    var body: some View {
        Text(initials)
            .font(Inter.font(size: 10, weight: 600))
            .foregroundStyle(.white)
            .frame(width: Theme.Row.avatarSize, height: Theme.Row.avatarSize)
            .background(Circle().fill(Color(hex: "#7d2800")))
    }
}

struct HzBadge: View {
    let count: Int
    var body: some View {
        Text("\(count)")
            .font(Theme.Badge.font)
            .monospacedDigit()
            .foregroundStyle(Theme.Badge.fg)
            .padding(.horizontal, Theme.Badge.padX)
            .frame(minWidth: Theme.Badge.minWidth, minHeight: Theme.Badge.height)
            .background(Capsule().fill(Theme.Badge.bg))
    }
}

/// An `hz:ext` placeholder: the registered native view if iOS implements it, else its fallback slot.
struct HzExtension: View {
    let node: HzNode
    let runtime: EffectUiRuntime

    var body: some View {
        let ext = ExtProps(node.props)
        Group {
            if let draw = HazelExtensions.registry[ext.name] {
                draw(ext.args) { event, payload in runtime.fire(node.id, event, payload: payload) }
            } else if let fallback = node.slot("fallback") {
                HzView(node: fallback, runtime: runtime)
                    .padding(.vertical, 10)
                    .padding(.horizontal, 12)
                    .overlay(RoundedRectangle(cornerRadius: Theme.Row.radius).strokeBorder(Theme.bandBorder, style: StrokeStyle(lineWidth: 1, dash: [4, 3])))
            }
        }
        .padding(.top, 12)
    }
}

/// What the last batch cost, so the numbers are in the screenshot.
struct HzStats: View {
    let tree: EffectUiTree
    var body: some View {
        Text("wire v\(Wire.version) · \(tree.batches) batches · last \(tree.lastOps) ops, \(tree.lastBytes) B, \(String(format: "%.2f", tree.lastApplyMs)) ms")
            .font(Inter.font(size: 12, weight: 400))
            .foregroundStyle(Theme.Section.label)
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.leading, Theme.Section.chevronLeading)
            .padding(.vertical, 16)
    }
}

/// The web's pressed wash (`--wash`) under a row while it is held.
struct PressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.background(
            RoundedRectangle(cornerRadius: Theme.Row.radius)
                .fill(configuration.isPressed ? Theme.pressedBg : .clear)
        )
    }
}
