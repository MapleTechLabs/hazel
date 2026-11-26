import SwiftUI
import UIKit

// What the overlay primitives share (lane S3): menu entries as data, the system menu built from
// them, icon images, the panel box, and the rule for drawing an overlay in place.

// MARK: in place

extension Node {
    /// An overlay that is the tree's own root child (a gallery case, a snapshot) has no screen to float
    /// over, so it draws its presented content in place, as the web does in a specimen frame.
    var overlayInPlace: Bool { parent == Tree.rootId }
}

/// A controlled overlay's binding: `open` as the body read it (so the body observes it), and a system
/// dismissal (swipe, outside tap) asks the view to close with `dismiss`; `open` false closes it.
@MainActor
func overlayDismissBinding(_ tree: Tree, _ node: Node, _ open: Bool) -> Binding<Bool> {
    Binding(
        get: { open },
        set: { open in if !open { tree.fire(node.id, "dismiss") } }
    )
}

// MARK: menu entries (`content.ts` `MenuGroups`)

struct OverlayMenuGroup: Decodable, Equatable {
    var title: String?
    var entries: [OverlayMenuEntry]
}

struct OverlayMenuEntry: Decodable, Equatable {
    var id: String
    var label: String
    var icon: String?
    var destructive: Bool?
    var disabled: Bool?
    var checked: Bool?
    /// One level of submenu (`menu-submenu`); a submenu's own entries never nest further.
    var entries: [OverlayMenuEntry]?

    static func groups(_ value: JSONValue?) -> [OverlayMenuGroup] {
        (try? value?.decode([OverlayMenuGroup].self)) ?? []
    }
}

/// The system menu's items for `groups`: a section per group (titled when it has one, separated
/// from the next), a submenu per entry with entries, a check per `checked`; a pick reports its id.
struct OverlayMenuItems: View {
    let groups: [OverlayMenuGroup]
    let select: (String) -> Void

    var body: some View {
        ForEach(Array(groups.enumerated()), id: \.offset) { _, group in
            Section {
                ForEach(group.entries, id: \.id) { entry in
                    if let children = entry.entries {
                        Menu {
                            ForEach(children, id: \.id) { OverlayMenuItem(entry: $0, select: select) }
                        } label: {
                            OverlayMenuLabel(entry: entry)
                        }
                        .disabled(entry.disabled == true)
                    } else {
                        OverlayMenuItem(entry: entry, select: select)
                    }
                }
            } header: {
                if let title = group.title { Text(title) }
            }
        }
    }
}

private struct OverlayMenuItem: View {
    let entry: OverlayMenuEntry
    let select: (String) -> Void

    var body: some View {
        // A checked entry is a toggle, the system's own check mark; picking it reports its id.
        if let checked = entry.checked {
            Toggle(isOn: Binding(get: { checked }, set: { _ in select(entry.id) })) { OverlayMenuLabel(entry: entry) }
                .disabled(entry.disabled == true)
        } else {
            Button(role: entry.destructive == true ? .destructive : nil) { select(entry.id) } label: {
                OverlayMenuLabel(entry: entry)
            }
            .disabled(entry.disabled == true)
        }
    }
}

private struct OverlayMenuLabel: View {
    let entry: OverlayMenuEntry

    var body: some View {
        if let icon = entry.icon {
            Label { Text(entry.label) } icon: { OverlayIcon.image(icon) }
        } else {
            Text(entry.label)
        }
    }
}

// MARK: icons

/// An icon by its vocabulary name (`options.ts` `iconNames`): the app's own asset when the bundle
/// has one (`scripts/export-icons.ts`), else the nearest SF Symbol, which system menus draw anyway.
enum OverlayIcon {
    static let symbols: [String: String] = [
        "arrow-up": "arrow.up", "bell": "bell", "check": "checkmark", "chevron-down": "chevron.down",
        "chevron-right": "chevron.right", "close": "xmark", "copy": "doc.on.doc", "discord": "bubble.left.and.bubble.right",
        "dots": "ellipsis", "download": "arrow.down.circle", "edit": "pencil", "emoji": "face.smiling",
        "emoji-add": "face.smiling.inverse", "gear": "gearshape", "gif": "photo.on.rectangle", "hashtag": "number",
        "leave": "rectangle.portrait.and.arrow.right", "lightbulb": "lightbulb", "lock": "lock",
        "office": "building.2", "paperclip": "paperclip", "pin": "pin", "plus": "plus",
        "reply": "arrowshape.turn.up.left", "search": "magnifyingglass", "share": "square.and.arrow.up",
        "slack": "number.square", "sparkles": "sparkles", "star": "star", "thread": "bubble.left.and.text.bubble.right",
        "trash": "trash", "users": "person.2", "volume-mute": "speaker.slash", "warning": "exclamationmark.triangle",
    ]

    static func image(_ name: String) -> Image {
        if UIImage(named: "hazel.\(name)") != nil { return Image("hazel.\(name)").renderingMode(.template) }
        return Image(systemName: symbols[name] ?? "questionmark")
    }
}

/// An icon part (`itemIcon`, `close`, `buttonIcon`): the image in the part's square and ink.
struct OverlayPartIcon: View {
    let name: String
    let style: HazelTheme.Style

    var body: some View {
        OverlayIcon.image(name)
            .resizable()
            .scaledToFit()
            .fontWeight(.medium)
            .padding((style.size ?? 0) / 4)
            .hzSize(style)
            .foregroundStyle(style.color?.color ?? Color.primary)
    }
}

// MARK: panels

extension View {
    /// A recipe's floating panel: `hzBox`, plus its hairline border and shadow.
    func hzOverlayPanel(_ style: HazelTheme.Style) -> some View {
        let shape = RoundedRectangle(cornerRadius: min(style.radius ?? 0, 1000), style: .continuous)
        return hzBox(style)
            .overlay {
                if let border = style.borderColor { shape.strokeBorder(border.color, lineWidth: style.borderWidth ?? 1) }
            }
            // On the shape alone: a shadow on the whole panel would shadow every glyph inside it.
            .background { shape.fill(style.background?.color ?? .clear).modifier(OverlayShadow(name: style.shadow)) }
            .foregroundStyle(style.color?.color ?? Color.primary)
    }

    /// The scrim a modal specimen sits on (`overlay-backdrop`).
    func hzOverlayScrim() -> some View {
        background(HazelTheme.Colors.overlayBackdrop.color)
    }
}

/// A theme shadow (`HazelTheme.shadows`) for the current scheme; inset layers have no SwiftUI form.
struct OverlayShadow: ViewModifier {
    let name: String?
    @Environment(\.colorScheme) private var scheme

    func body(content: Content) -> some View {
        let layers = name.flatMap { HazelTheme.shadows[$0] }.map { scheme == .dark ? $0.dark : $0.light } ?? []
        layers.filter { !$0.inset }.reduce(AnyView(content)) { view, shadow in
            AnyView(view.shadow(color: Color(uiColor: shadow.color.uiColor), radius: shadow.blur / 2, x: shadow.x, y: shadow.y))
        }
    }
}

/// A close or dismiss button: the recipe's `close` part around the `close` icon.
struct OverlayCloseButton: View {
    let style: HazelTheme.Style
    let label: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            OverlayPartIcon(name: "close", style: style).contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityLabel(label)
    }
}

extension Node {
    /// A text prop, or nil when unset or empty.
    func overlayText(_ key: String) -> String? {
        guard let value = props[key]?.string, !value.isEmpty else { return nil }
        return value
    }
}
