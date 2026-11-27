import SwiftUI

// Owned by lane S2. `hz:textArea`: a labelled multi-line `TextField` (three lines tall, like the web's
// `rows=3`) with the revision pair. Return is a new line; Cmd+Return on a hardware keyboard submits.
struct HzTextArea: View {
    let tree: Tree
    let node: Node
    @State private var input = RevisionedText()
    @FocusState private var focused: Bool
    @State private var hovering = false
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let sizeClass = HazelTheme.SizeClass(horizontalSizeClass)
        let disabled = node.flag("disabled")
        let error = node.string("error")
        var states: Set<HazelTheme.State> = disabled ? [.disabled] : []
        if hovering { states.insert(.hover) }
        let s = HazelTheme.Recipes.textArea.styles(
            ["label", "caption", "required", "input", "description", "error"],
            flags: error == nil ? [] : ["invalid"], states: states, sizeClass: sizeClass)
        let field = s["input"]!
        let label = node.string("label") ?? ""
        let line = field.lineHeight(sizeClass)

        return FieldLayout(tag: "textArea", styles: s, label: label, required: false,
                           description: node.string("description"), error: error, sizeClass: sizeClass) {
            TextField(text: input.binding, selection: $input.selection,
                      prompt: Text(node.string("placeholder") ?? "").foregroundStyle(HazelTheme.Colors.mutedFg.color),
                      axis: .vertical) {
                Text(label)
            }
            .font(field.controlFont(sizeClass))
            .lineSpacing(field.lineSpacing(sizeClass))
            .foregroundStyle(field.color?.color ?? .primary)
            .lineLimit(3 ... 12)
            .frame(minHeight: 3 * line, alignment: .topLeading)
            .focused($focused)
            .disabled(disabled)
            .onKeyPress(.return, phases: .down) { press in
                guard press.modifiers.contains(.command) else { return .ignored }
                input.submit()
                return .handled
            }
            .hzControlBox(field, scheme)
            .hzFocusRing(focused, field.shape)
            .onHover { hovering = $0 }
            .accessibilityLabel(label)
        }
        .hzTextControl(tree, node, input, focused: $focused)
    }
}
