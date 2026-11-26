import SwiftUI

// Owned by lane S2. `hz:textField` (G5's field, moved here): a native `TextField` that owns its text
// while editing and takes Model `value`s by the revision rule (`TextRevisions`). Return submits and
// keeps the keyboard up, so typing goes on into a field the Model cleared.
struct HzTextField: View {
    let tree: Tree
    let node: Node
    @State private var input = RevisionedText()
    @FocusState private var focused: Bool
    @State private var hovering = false
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let sizeClass = HazelTheme.SizeClass(horizontalSizeClass)
        let disabled = node.flag("disabled"), readOnly = node.flag("readOnly")
        let error = node.string("error")
        var flags: Set<String> = []
        if readOnly { flags.insert("readOnly") }
        if node.flag("monospace") { flags.insert("monospace") }
        if error != nil { flags.insert("invalid") }
        var states: Set<HazelTheme.State> = disabled ? [.disabled] : []
        if hovering { states.insert(.hover) }
        let s = HazelTheme.Recipes.textField.styles(
            ["label", "caption", "required", "input", "description", "error"],
            flags: flags, states: states, sizeClass: sizeClass)
        let field = s["input"]!
        let label = node.string("label") ?? ""

        return FieldLayout(styles: s, label: label, required: node.flag("required"),
                           description: node.string("description"), error: error, sizeClass: sizeClass) {
            // Read-only keeps focus and selection; writes are dropped, so the text never changes.
            TextField(text: readOnly ? .constant(input.text) : input.binding, selection: $input.selection,
                      prompt: Text(node.string("placeholder") ?? "").foregroundStyle(HazelTheme.Colors.mutedFg.color)) {
                Text(label)
            }
            .font(field.controlFont(sizeClass))
            .foregroundStyle(field.color?.color ?? .primary)
            .frame(minHeight: field.lineHeight(sizeClass))
            .textInputAutocapitalization(node.flag("monospace") ? .never : nil)
            .autocorrectionDisabled(node.flag("monospace"))
            .submitLabel(.done)
            .focused($focused)
            .disabled(disabled)
            .onSubmit {
                input.submit()
                focused = true
            }
            .hzControlBox(field, scheme)
            .hzFocusRing(focused, field.shape)
            .onHover { hovering = $0 }
            .animation(controlAnimation(field.transition, reduceMotion: false), value: hovering)
            .accessibilityLabel(label)
            .accessibilityIdentifier("hz-textField")
        }
        .hzTextControl(tree, node, input, focused: $focused)
    }
}

/// A labelled field's parts (textField, textArea): caption and required marker, the control, then the
/// description and error lines, spaced by the recipe's gaps.
struct FieldLayout<Control: View>: View {
    let styles: [String: HazelTheme.Style]
    let label: String
    let required: Bool
    let description: String?
    let error: String?
    let sizeClass: HazelTheme.SizeClass
    @ViewBuilder let control: () -> Control

    var body: some View {
        let root = styles[""]!, labelPart = styles["label"]!
        VStack(alignment: .leading, spacing: root.gap ?? 0) {
            VStack(alignment: .leading, spacing: labelPart.rowGap ?? labelPart.gap ?? 0) {
                if !label.isEmpty || required {
                    HStack(spacing: labelPart.gap ?? 0) {
                        if !label.isEmpty { Text(label).hzText(styles["caption"]!, sizeClass) }
                        if required { Text("*").hzText(styles["required"]!, sizeClass).accessibilityHidden(true) }
                    }
                }
                control()
            }
            if let description {
                Text(description).hzText(styles["description"]!, sizeClass).fixedSize(horizontal: false, vertical: true)
            }
            if let error {
                Text(error).hzText(styles["error"]!, sizeClass).fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: root.fill == true ? .infinity : nil, alignment: .leading)
        .opacity(root.opacity ?? 1)
    }
}
