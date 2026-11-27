import SwiftUI

// Owned by lane S2. `hz:select`: a labelled system menu (a menu-style `Picker`) under a control drawn
// from the select recipe. A choice raises `change {value}`; what shows always follows the Model's
// `value`, and the placeholder shows while it matches no option.
struct HzSelect: View {
    let tree: Tree
    let node: Node
    @State private var hovering = false
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @Environment(\.colorScheme) private var scheme

    private struct Choice: Decodable, Hashable { let value: String, label: String }

    var body: some View {
        let sizeClass = HazelTheme.SizeClass(horizontalSizeClass)
        let choices = (try? node.props["options"]?.decode([Choice].self)) ?? []
        let value = node.string("value")
        let chosen = choices.first { $0.value == value }
        let disabled = node.flag("disabled")
        var states: Set<HazelTheme.State> = disabled ? [.disabled] : []
        if hovering { states.insert(.hover) }
        let s = HazelTheme.Recipes.select.styles(
            ["label", "caption", "control", "input", "icon"],
            flags: chosen == nil ? ["placeholder"] : [], states: states, sizeClass: sizeClass)
        let root = s[""]!, labelPart = s["label"]!, control = s["control"]!, input = s["input"]!, icon = s["icon"]!
        let label = node.string("label") ?? ""
        let selection = Binding(get: { value ?? "" }, set: { next in
            if next != value { tree.fire(node.id, "change", ["value": .string(next)]) }
        })

        return VStack(alignment: .leading, spacing: labelPart.gap ?? 0) {
            if !label.isEmpty { Text(label).hzText(s["caption"]!, sizeClass) }
            Menu {
                Picker(label, selection: selection) {
                    ForEach(choices, id: \.self) { Text($0.label).tag($0.value) }
                }
                .pickerStyle(.inline)
            } label: {
                HStack(spacing: control.gap ?? 0) {
                    Text(chosen?.label ?? node.string("placeholder") ?? "")
                        .hzText(input, sizeClass)
                        .lineLimit(1)
                        .padding(.vertical, input.paddingY ?? 0)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    ControlIcon(name: "chevron-down", size: icon.size ?? 16, color: icon.color?.color ?? .secondary)
                }
                .hzControlBox(control, scheme)
            }
            .buttonStyle(.plain)
            .onHover { hovering = $0 }
            .disabled(disabled)
            .accessibilityLabel(label)
            .accessibilityValue(chosen?.label ?? "")
        }
        .frame(maxWidth: root.fill == true ? .infinity : nil, alignment: .leading)
        .opacity(root.opacity ?? 1)
    }
}
