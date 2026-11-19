import SwiftUI

/// A converted screen, drawn with native views that look like the web's: each node where the web
/// put it, in the web's colours, type and shapes (`Look`). What is native is everything they do:
/// scrolling, presses, the system's menus, navigation.
struct NativeScreen: View {
    let screen: SemanticNode
    let bridge: WebBridge

    var body: some View {
        VStack(spacing: 0) {
            bands(pinned: "top")
            ScrollView {
                Canvas(blocks: blocks.filter { $0.pin == nil }, bridge: bridge)
            }
            .scrollIndicators(.hidden)
            bands(pinned: "bottom")
        }
        .background(Color(css: screen.look?.bg).ignoresSafeArea())
        // A keyboard is the screen's that types (a pushed chat's composer), never this one's: the
        // list under a back swipe stays laid out as it is.
        .ignoresSafeArea(.keyboard)
        .toolbar(.hidden, for: .navigationBar)
    }

    /// The header or footer a pinned node sits in, drawn as the web's band around it.
    @ViewBuilder
    private func bands(pinned: String) -> some View {
        ForEach(blocks.filter { $0.pin == pinned }) { block in
            if let band = block.node.look?.band {
                Canvas(blocks: [block], bridge: bridge)
                    .frame(height: band.box.h)
                    .background(Color(css: band.bg))
                    .overlay(alignment: .top) { line(band.borderTop) }
                    .overlay(alignment: .bottom) { line(band.borderBottom) }
            }
        }
    }

    @ViewBuilder
    private func line(_ color: String?) -> some View {
        if let color { Rectangle().fill(Color(css: color)).frame(height: 1) }
    }

    /// Every node that draws something, at the place the web gave it.
    private var blocks: [Block] {
        var out: [Block] = []
        func walk(_ nodes: [SemanticNode]) {
            for node in nodes {
                switch node.kind {
                case "section":
                    if !node.title.isEmpty { out.append(Block(node: node, role: .sectionHeader)) }
                    walk(node.children)
                case "item":
                    out.append(Block(node: node, role: .item))
                    walk(node.children)
                case "action":
                    out.append(Block(node: node, role: .action))
                case "unconverted":
                    out.append(Block(node: node, role: .unconverted))
                default:
                    walk(node.children)
                }
            }
        }
        walk(screen.children)
        return out
    }
}

struct Block: Identifiable {
    enum Role { case sectionHeader, item, action, unconverted }
    let node: SemanticNode
    let role: Role
    var id: String { "\(node.id)-\(role)" }
    var pin: String? { role == .item ? node.props["pin"]?.string : nil }
}

/// Blocks placed where the web placed them.
private struct Canvas: View {
    let blocks: [Block]
    let bridge: WebBridge

    var body: some View {
        let height = blocks.compactMap { $0.node.look.map { $0.box.y + $0.box.h } }.max() ?? 0
        ZStack(alignment: .topLeading) {
            Color.clear.frame(height: height + 12)
            ForEach(blocks) { block in
                if let look = block.node.look {
                    BlockView(block: block, look: look, bridge: bridge)
                        .frame(width: look.box.w, height: look.box.h, alignment: .topLeading)
                        .offset(x: look.box.x, y: look.box.y)
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .topLeading)
    }
}

private struct BlockView: View {
    let block: Block
    let look: Look
    let bridge: WebBridge

    var body: some View {
        switch block.role {
        case .sectionHeader:
            if let label = look.label {
                ZStack(alignment: .topLeading) {
                    if let icon = look.icon, let key = icon.image, let image = bridge.icons[key] {
                        Image(uiImage: image).resizable().frame(width: icon.size, height: icon.size)
                            .offset(x: icon.x, y: look.iconY ?? 0)
                    }
                    Text(block.node.title).web(label)
                        .offset(x: label.x ?? 0, y: label.y ?? 0)
                }
            }
        case .action:
            let entries = MenuEntry.parse(block.node.props["pullDown"]?["items"])
            let icon = WebIcon(
                image: look.icon?.image.flatMap { bridge.icons[$0] },
                symbol: block.node.props["symbol"]?.string ?? "plus",
                size: look.icon?.size ?? 16,
                color: look.icon?.color
            )
            .frame(width: look.box.w, height: look.box.h)
            .contentShape(.rect)
            let style = PressStyle(pressed: Color(css: "#80808026"), radius: look.box.h / 2)
            Group {
                if entries.isEmpty {
                    Button {
                        UISelectionFeedbackGenerator().selectionChanged()
                        bridge.press(block.node)
                    } label: { icon }
                    .buttonStyle(style)
                } else {
                    Menu { MenuItems(entries: entries, node: block.node, bridge: bridge) } label: { icon }
                        .buttonStyle(style)
                }
            }
            .accessibilityLabel(block.node.props["label"]?.string ?? "")
        case .unconverted:
            if let label = look.label {
                Text(block.node.text).web(label).lineLimit(1)
            }
        case .item:
            ItemView(node: block.node, look: look, bridge: bridge)
        }
    }
}

/// A row as the web draws it, pressed and long-pressed natively.
private struct ItemView: View {
    let node: SemanticNode
    let look: Look
    let bridge: WebBridge

    private var props: JSONValue { node.props }
    private var contextMenu: [MenuEntry] { MenuEntry.parse(props["menu"]?["items"]) }
    private var pullDown: [MenuEntry] { MenuEntry.parse(props["pullDown"]?["items"]) }

    var body: some View {
        let pressed = PressStyle(pressed: Color(css: look.pressedBg), radius: look.radius ?? 0)
        Group {
            if pullDown.isEmpty {
                Button {
                    UISelectionFeedbackGenerator().selectionChanged()
                    bridge.press(node)
                } label: { row }
                .buttonStyle(pressed)
            } else {
                // The web opens its menu here; natively it is the system's.
                Menu {
                    if let title = props["pullDown"]?["title"]?.string {
                        Section(title) { MenuItems(entries: pullDown, node: node, bridge: bridge) }
                    } else {
                        MenuItems(entries: pullDown, node: node, bridge: bridge)
                    }
                } label: { row }
                .buttonStyle(pressed)
            }
        }
        .contextMenu(contextMenu.isEmpty ? nil : ContextMenu {
            MenuItems(entries: contextMenu, node: node, bridge: bridge)
        })
        // Outside the row's press and long-press, so the system's menu does not lift it.
        .overlay(alignment: .topLeading) { branch }
    }

    private var row: some View {
        ZStack(alignment: .leading) {
            RoundedRectangle(cornerRadius: look.radius ?? 0)
                .fill(Color(css: look.bg))
            if let border = look.border {
                RoundedRectangle(cornerRadius: look.radius ?? 0)
                    .strokeBorder(Color(css: border.color), lineWidth: border.width)
            }
            if let icon = look.icon {
                iconView(icon).offset(x: icon.x)
            }
            if let label = look.label {
                VStack(alignment: .leading, spacing: 0) {
                    Text(node.title).web(label).lineLimit(1)
                    if let subtitle = look.subtitle, let text = props["subtitle"]?.string {
                        Text(text).web(subtitle).lineLimit(1)
                    }
                }
                .padding(.leading, label.x ?? 0)
                .padding(.trailing, trailingRoom)
            }
            HStack(spacing: 0) {
                Spacer(minLength: 0)
                if let badge = look.badge, let count = props["badge"]?.int {
                    Text("\(count)")
                        .font(WebFont.font(size: badge.size, weight: badge.weight))
                        .monospacedDigit()
                        .foregroundStyle(Color(css: badge.color))
                        .padding(.horizontal, badge.padX)
                        .frame(minWidth: badge.minW, minHeight: badge.h)
                        .background(Color(css: badge.bg), in: .rect(cornerRadius: badge.radius))
                        .padding(.trailing, badge.right)
                }
                if let trailing = look.trailing, let symbol = props["trailingSymbol"]?.string {
                    WebIcon(
                        image: trailing.image.flatMap { bridge.icons[$0] },
                        symbol: symbol,
                        size: trailing.size,
                        color: trailing.color
                    )
                    .padding(.trailing, trailing.right)
                }
            }
        }
        .frame(width: look.box.w, height: look.box.h)
        .contentShape(.rect)
    }

    /// A thread's line to its channel, left of the row and reaching up into the channel's.
    @ViewBuilder
    private var branch: some View {
        if let branch = look.branch, let image = bridge.icons[branch.image] {
            Image(uiImage: image)
                .resizable()
                .frame(width: branch.w, height: branch.h)
                .offset(x: branch.x, y: branch.y)
                .allowsHitTesting(false)
        }
    }

    private var trailingRoom: CGFloat {
        (look.badge.map { $0.right + $0.minW + 8 } ?? 0) + (look.trailing.map { $0.right + $0.size + 4 } ?? 0)
    }

    @ViewBuilder
    private func iconView(_ icon: Look.Icon) -> some View {
        if let emoji = props["emoji"]?.string {
            Text(emoji).font(.system(size: icon.size * 0.9)).frame(width: icon.size)
        } else if let avatar = icon.avatar {
            WebAvatar(avatar: avatar, size: icon.size, radius: icon.radius, bridge: bridge)
        } else if let avatar = props["avatar"] {
            AvatarView(url: avatar["url"]?.string, initials: avatar["initials"]?.string ?? "", size: icon.size, radius: icon.radius, bridge: bridge)
        } else {
            WebIcon(
                image: icon.image.flatMap { bridge.icons[$0] },
                symbol: props["symbol"]?.string ?? "circle",
                size: icon.size,
                color: icon.color
            )
        }
    }
}

/// The web's pressed fill, under the finger as it goes down.
private struct PressStyle: ButtonStyle {
    let pressed: Color
    let radius: CGFloat

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .background(configuration.isPressed ? pressed : .clear, in: .rect(cornerRadius: radius))
            .animation(.easeOut(duration: 0.1), value: configuration.isPressed)
    }
}

private struct MenuItems: View {
    let entries: [MenuEntry]
    let node: SemanticNode
    let bridge: WebBridge

    var body: some View {
        ForEach(entries) { entry in
            switch entry.kind {
            case .separator:
                Divider()
            case let .submenu(children):
                Menu(entry.label) { MenuItems(entries: children, node: node, bridge: bridge) }
            case let .item(key, isDestructive, isChecked):
                Button(role: isDestructive ? .destructive : nil) {
                    bridge.choose(node, key: key)
                } label: {
                    if isChecked {
                        Label(entry.label, systemImage: "checkmark")
                    } else if let key = entry.image, let image = bridge.icons[key] {
                        // The web item's own icon, in the colour a system menu gives its symbols (a
                        // SwiftUI menu would tint a template image with the app's accent).
                        Label {
                            Text(entry.label)
                        } icon: {
                            Image(uiImage: image.withTintColor(isDestructive ? .systemRed : .label, renderingMode: .alwaysOriginal))
                        }
                    } else if let symbol = entry.symbol {
                        Label(entry.label, systemImage: symbol)
                    } else {
                        Text(entry.label)
                    }
                }
            }
        }
    }
}

private struct AvatarView: View {
    let url: String?
    let initials: String
    let size: CGFloat
    let radius: CGFloat
    let bridge: WebBridge

    var body: some View {
        Picture(src: url, size: size, bridge: bridge) { placeholder }
            .frame(width: size, height: size)
            .clipShape(.rect(cornerRadius: min(radius, size / 2)))
    }

    private var placeholder: some View {
        Text(initials)
            .font(WebFont.font(size: size * 0.42, weight: 600))
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color(css: "#6938efff").gradient)
    }
}

/// The page's own icon, as it rasterized it; an SF Symbol only until that arrives.
private struct WebIcon: View {
    let image: UIImage?
    let symbol: String
    let size: CGFloat
    let color: String?

    var body: some View {
        Group {
            if let image {
                Image(uiImage: image).resizable().interpolation(.high)
            } else {
                Image(systemName: symbol)
                    .font(.system(size: size * 0.8, weight: .regular))
                    .foregroundStyle(Color(css: color))
            }
        }
        .frame(width: size, height: size)
    }
}

/// An avatar as the web draws it: its picture, or the dithered fill (colour, pattern, initial).
private struct WebAvatar: View {
    let avatar: Look.Avatar
    let size: CGFloat
    let radius: CGFloat
    let bridge: WebBridge

    var body: some View {
        Picture(src: avatar.src, size: size, bridge: bridge) { fill }
        .frame(width: size, height: size)
        .clipShape(.rect(cornerRadius: min(radius, size / 2), style: .continuous))
    }

    private var fill: some View {
        ZStack {
            Color(css: avatar.bg)
            if let key = avatar.pattern, let pattern = bridge.icons[key] {
                Image(uiImage: pattern).resizable().interpolation(.none)
            }
            if let initial = avatar.initial {
                Text(initial.char)
                    .font(WebFont.font(size: initial.size, weight: initial.weight))
                    .foregroundStyle(Color(css: initial.color))
            }
        }
    }
}

/// A picture by its source, from the app's picture loader (`ImageLoader.swift`: network, `data:`,
/// or the app's own `hazel://` files); `placeholder` until it arrives, or if it never does.
private struct Picture<Placeholder: View>: View {
    let src: String?
    let size: CGFloat
    let bridge: WebBridge
    @ViewBuilder let placeholder: () -> Placeholder
    @State private var image: UIImage?

    var body: some View {
        ZStack {
            if let image {
                Image(uiImage: image).resizable().scaledToFill()
            } else {
                placeholder()
            }
        }
        .task(id: src) {
            guard let src else {
                image = nil
                return
            }
            image = await bridge.pictures.image(src, size: CGSize(width: size, height: size), scale: 3)
        }
    }
}
