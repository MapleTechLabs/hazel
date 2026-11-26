import SwiftUI
import UniformTypeIdentifiers

// Owned by lane S2. `hz:composer` (phase 2 leaf): the `above` slot, a growing multi-line `TextField`
// with the revision pair, then the `actions` slot and a send button. The software keyboard's Return is
// a new line (send with the button); on a hardware keyboard Return sends and Shift+Return breaks.
struct HzComposer: View {
    let tree: Tree
    let node: Node
    @State private var input = RevisionedText()
    @State private var trigger: ComposerTrigger?
    @FocusState private var focused: Bool
    @State private var hovering = false
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let sizeClass = HazelTheme.SizeClass(horizontalSizeClass)
        let disabled = node.flag("disabled"), canSend = node.flag("canSend")
        var states: Set<HazelTheme.State> = disabled ? [.disabled] : []
        if hovering { states.insert(.hover) }
        let s = HazelTheme.Recipes.composer.styles(
            ["input", "send", "above", "actions"], flags: canSend ? ["canSend"] : [], states: states,
            sizeClass: sizeClass)
        let root = s[""]!, field = s["input"]!, send = s["send"]!
        let placeholder = node.string("placeholder") ?? ""

        // Three rows always, as the web's grid keeps its row gaps when a slot is empty.
        return VStack(alignment: .leading, spacing: root.gap ?? 0) {
            HStack(spacing: s["above"]!.gap ?? 0) { SlotView(tree: tree, node: node, name: "above") }
            TextField(text: input.binding, selection: $input.selection,
                      prompt: Text(placeholder).foregroundStyle(HazelTheme.Colors.mutedFg.color), axis: .vertical) {
                Text(placeholder.isEmpty ? "Message" : placeholder)
            }
            .font(field.controlFont(sizeClass))
            .lineSpacing(field.lineSpacing(sizeClass))
            .foregroundStyle(field.color?.color ?? .primary)
            .lineLimit(1 ... 8)
            .frame(minHeight: field.lineHeight(sizeClass))
            .focused($focused)
            .disabled(disabled)
            .onKeyPress(keys: [.upArrow, .downArrow, .return, .tab, .escape], phases: .down) { press in
                handleKey(press, canSend: canSend && !disabled)
            }
            .hzBox(field)
            HStack(spacing: s["actions"]!.gap ?? 0) {
                SlotView(tree: tree, node: node, name: "actions")
                Spacer(minLength: 0)
                Button {
                    if canSend, !disabled { input.submit() }
                } label: {
                    ControlIcon(name: "arrow-up", size: 16, color: send.color?.color ?? .secondary)
                        .hzSize(send)
                        .hzControlBox(send, scheme)
                }
                .buttonStyle(.plain)
                .disabled(disabled || !canSend)
                .accessibilityLabel("Send")
            }
        }
        .hzControlBox(root, scheme)
        .onHover { hovering = $0 }
        .onDrop(of: [.fileURL, .image, .data], isTargeted: nil) { providers in
            guard tree.handles(node.id, "files"), !providers.isEmpty else { return false }
            ComposerDrops.dropped = providers
            tree.fire(node.id, "files", ["count": .number(Double(providers.count))])
            return true
        }
        .onChange(of: input.text) { syncTrigger() }
        .onChange(of: input.selection) { syncTrigger() }
        .hzTextControl(tree, node, input, focused: $focused)
    }

    private func handleKey(_ press: KeyPress, canSend: Bool) -> KeyPress.Result {
        let key: String? = switch press.key {
        case .upArrow: "up"
        case .downArrow: "down"
        case .return: "enter"
        case .tab: "tab"
        case .escape: "escape"
        default: nil
        }
        if trigger != nil, let key, !press.modifiers.contains(.shift), tree.handles(node.id, "key") {
            tree.fire(node.id, "key", ["key": .string(key)])
            if key == "escape" { trigger = nil }
            return .handled
        }
        guard press.key == .return, !press.modifiers.contains(.shift) else { return .ignored }
        if canSend { input.submit() }
        return .handled
    }

    /// Raises `trigger` when the caret enters or leaves `@ # / :` at a word start (`query` null on close).
    private func syncTrigger() {
        let next = input.caret.flatMap { ComposerTrigger.at(input.text, caret: $0) }
        guard next != trigger else { return }
        let closed = trigger
        trigger = next
        guard tree.handles(node.id, "trigger") else { return }
        if let next {
            tree.fire(node.id, "trigger", ["kind": .string(next.kind), "query": .string(next.query)])
        } else if let closed {
            tree.fire(node.id, "trigger", ["kind": .string(closed.kind), "query": .null])
        }
    }
}

/// The trigger the caret is in (the web's `triggerAt`): a trigger character at a word start, then no
/// whitespace; a command (`/`) only as the message's first word.
struct ComposerTrigger: Equatable {
    let kind: String
    let query: String

    static func at(_ text: String, caret: Int) -> ComposerTrigger? {
        let before = String(text.utf16.prefix(caret)) ?? text
        let marks: Set<Character> = ["@", "#", "/", ":"]
        var query = ""
        for (index, char) in zip(before.indices, before).reversed() {
            if marks.contains(char) {
                let start = index == before.startIndex || before[before.index(before: index)].isWhitespace
                guard start else { return nil }
                if char == "/", before.drop(while: \.isWhitespace).first != "/" { return nil }
                return ComposerTrigger(kind: String(char), query: query)
            }
            if char.isWhitespace { return nil }
            query.insert(char, at: query.startIndex)
        }
        return nil
    }
}

/// The items of the last `files` event, for the iOS `Files.dropped` (lane F); taking clears them.
@MainActor
enum ComposerDrops {
    static var dropped: [NSItemProvider] = []
    static func take() -> [NSItemProvider] {
        defer { dropped = [] }
        return dropped
    }
}
