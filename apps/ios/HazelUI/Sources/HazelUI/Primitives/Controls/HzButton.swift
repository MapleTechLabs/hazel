import SwiftUI

// Owned by lane S2. `hz:button`: a SwiftUI `Button` drawn from the button recipe (variant, size,
// iconOnly, circle; selected, pressed and hover states). `loading` keeps it focusable but swallows presses.
// `removable` adds the trailing remove mark (a filter chip, a tag): a tap on it, or the accessibility
// action Remove, raises `remove` instead of `press`.
struct HzButton: View {
    let tree: Tree
    let node: Node
    @FocusState private var focused: Bool
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let label = node.string("label") ?? ""
        let loading = node.flag("loading"), disabled = node.flag("disabled")
        var options: [String: String] = [:]
        if let variant = node.string("variant") { options["variant"] = variant }
        if let size = node.string("size") { options["size"] = size }
        var flags: Set<String> = []
        if node.flag("iconOnly") { flags.insert("iconOnly") }
        if node.flag("circle") { flags.insert("circle") }
        var states: Set<HazelTheme.State> = []
        if disabled { states.insert(.disabled) }
        if loading { states.insert(.loading) }
        // `chip`'s on state (`filter-chip`), the web's `aria-pressed`.
        let selected = node.flag("selected")
        if selected { states.insert(.selected) }
        let removable = node.flag("removable")
        let remove = { if !loading, !disabled { tree.fire(node.id, "remove") } }

        return Button {
            if !loading { tree.fire(node.id, "press") }
        } label: {
            EmptyView()
        }
        .buttonStyle(ButtonFace(
            label: label, icon: node.string("icon"), options: options, flags: flags, states: states,
            sizeClass: HazelTheme.SizeClass(horizontalSizeClass), scheme: scheme,
            onRemove: removable ? remove : nil))
        .disabled(disabled)
        .focused($focused)
        .accessibilityLabel(label)
        .accessibilityAddTraits(loading ? [.updatesFrequently] : [])
        .accessibilityAddTraits(selected ? [.isSelected] : [])
        .modifier(RemoveAction(action: removable ? remove : nil))
        .hazelCommands(tree, node) { name, _ in
            guard name == .focus else { throw CommandError("hz:button does not handle \(name.rawValue)") }
            focused = true
            return nil
        }
    }
}

/// A removable button's accessibility action Remove (the mark itself is hidden from VoiceOver).
private struct RemoveAction: ViewModifier {
    let action: (() -> Void)?

    func body(content: Content) -> some View {
        if let action {
            content.accessibilityAction(named: "Remove", action)
        } else {
            content
        }
    }
}

/// The button's look, as a `ButtonStyle` so the press state comes from the system.
struct ButtonFace: ButtonStyle {
    let label: String
    let icon: String?
    let options: [String: String]
    let flags: Set<String>
    let states: Set<HazelTheme.State>
    let sizeClass: HazelTheme.SizeClass
    let scheme: ColorScheme
    /// Set when the button is `removable`: its trailing mark raises this, not the press.
    var onRemove: (() -> Void)? = nil

    func makeBody(configuration: Configuration) -> some View {
        Face(face: self, pressed: configuration.isPressed)
    }

    private struct Face: View {
        let face: ButtonFace
        let pressed: Bool
        @State private var hovering = false
        @Environment(\.accessibilityReduceMotion) private var reduceMotion

        var body: some View {
            var states = face.states
            if pressed { states.insert(.pressed) }
            if hovering { states.insert(.hover) }
            let s = HazelTheme.Recipes.button.styles(
                ["icon", "remove"], options: face.options, flags: face.flags, states: states,
                sizeClass: face.sizeClass)
            let root = s[""]!, icon = s["icon"]!, remove = s["remove"]!
            let iconOnly = face.flags.contains("iconOnly")
            return HStack(spacing: root.gap ?? 0) {
                if let name = face.icon {
                    ControlIcon(name: name, size: icon.size ?? 16, color: (icon.color ?? root.color)?.color ?? .primary)
                        .padding(.horizontal, -(icon.bleedX ?? 0))
                }
                if !iconOnly, !face.label.isEmpty {
                    Text(face.label).hzText(root, face.sizeClass).lineLimit(1).fixedSize()
                }
                if let onRemove = face.onRemove {
                    ControlIcon(name: "close", size: remove.size ?? 16, color: (remove.color ?? root.color)?.color ?? .primary)
                        .padding(.horizontal, -(remove.bleedX ?? 0))
                        .contentShape(Rectangle())
                        .highPriorityGesture(TapGesture().onEnded { onRemove() })
                        .accessibilityHidden(true)
                }
            }
            .hzSize(root)
            .hzControlBox(root, face.scheme)
            .onHover { hovering = $0 }
            .animation(controlAnimation(root, reduceMotion: reduceMotion), value: states)
        }
    }
}
