import SwiftUI

// Owned by lane S2. `hz:searchField`: a leading search icon and a `TextField` with the revision pair.
// Return submits; Escape (hardware keyboard) clears through the same `change` path as typing.
struct HzSearchField: View {
    let tree: Tree
    let node: Node
    @State private var input = RevisionedText()
    @FocusState private var focused: Bool
    @State private var hovering = false
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @Environment(\.colorScheme) private var scheme

    var body: some View {
        let sizeClass = HazelTheme.SizeClass(horizontalSizeClass)
        let s = HazelTheme.Recipes.searchField.styles(
            ["icon", "input"], states: hovering ? [.hover] : [], sizeClass: sizeClass)
        let root = s[""]!, icon = s["icon"]!, field = s["input"]!
        let placeholder = node.string("placeholder") ?? ""

        HStack(spacing: root.gap ?? 0) {
            ControlIcon(name: "search", size: icon.size ?? 16, color: icon.color?.color ?? .secondary)
            TextField(text: input.binding, selection: $input.selection,
                      prompt: Text(placeholder).foregroundStyle(HazelTheme.Colors.mutedFg.color)) {
                Text(placeholder.isEmpty ? "Search" : placeholder)
            }
            .font(field.controlFont(sizeClass))
            .foregroundStyle(field.color?.color ?? .primary)
            .frame(minHeight: field.lineHeight(sizeClass))
            .padding(.vertical, field.paddingY ?? 0)
            .frame(maxWidth: .infinity)
            .textInputAutocapitalization(.never)
            .submitLabel(.search)
            .focused($focused)
            .onSubmit {
                input.submit()
                focused = true
            }
            .onKeyPress(.escape) {
                guard !input.text.isEmpty else { return .ignored }
                input.type("")
                return .handled
            }
        }
        .hzControlBox(root, scheme)
        .hzFocusRing(focused, root.shape)
        .onHover { hovering = $0 }
        .accessibilityElement(children: .contain)
        .hzTextControl(tree, node, input, focused: $focused, select: false)
    }
}
