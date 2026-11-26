import SwiftUI

// Owned by lane S4. `hz:action`: a section's header action around its icon children. A press raises
// `press`; with `entries` it is a system menu (`Menu`, one submenu level) whose choice raises `select`.
struct HzAction: View {
    let tree: Tree
    let node: Node

    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @State private var hovering = false

    var body: some View {
        let label = node[prop: "label"]?.string ?? ""
        let groups = (try? node[prop: "entries"]?.decode([MenuGroupData].self)) ?? []
        Group {
            if groups.isEmpty {
                Button { tree.fire(node.id, "press") } label: { EmptyView() }
                    .buttonStyle(PressStyle { pressed in face(interactionStates(pressed: pressed, hovering: hovering)) })
            } else {
                Menu {
                    ForEach(Array(groups.enumerated()), id: \.offset) { _, group in
                        Section(group.title ?? "") {
                            ForEach(group.entries, id: \.id) { entry in
                                if let sub = entry.entries, !sub.isEmpty {
                                    Menu {
                                        ForEach(sub, id: \.id) { leaf($0) }
                                    } label: { entryLabel(entry) }
                                    .disabled(entry.disabled == true)
                                } else {
                                    leaf(entry)
                                }
                            }
                        }
                    }
                } label: { face(hovering ? [.hover] : []) }
                .buttonStyle(.plain)
            }
        }
        .onHover { hovering = $0 }
        .accessibilityLabel(label)
    }

    /// The 32pt square around the icon children, in the recipe's state.
    private func face(_ states: Set<HazelTheme.State>) -> some View {
        let sizeClass = HazelTheme.SizeClass(horizontalSizeClass)
        let root = HazelTheme.Recipes.action.style(states: states, sizeClass: sizeClass)
        let icon = HazelTheme.Recipes.action.style(part: "icon", sizeClass: sizeClass)
        let shape = RoundedRectangle(cornerRadius: root.radius ?? 0, style: .continuous)
        return ChildrenView(tree: tree, node: node)
            .hzSize(icon)
            .hzSize(root)
            .foregroundStyle(root.color?.color ?? Color.primary)
            .background(shape.fill(root.background?.color ?? .clear))
            .contentShape(shape)
            .animation(.easeOut(duration: root.transition ?? 0), value: states)
    }

    private func leaf(_ entry: MenuEntryData) -> some View {
        Button(role: entry.destructive == true ? .destructive : nil) {
            tree.fire(node.id, "select", ["id": .string(entry.id)])
        } label: { entryLabel(entry) }
        .disabled(entry.disabled == true)
    }

    @ViewBuilder private func entryLabel(_ entry: MenuEntryData) -> some View {
        if entry.checked == true {
            Label(entry.label, systemImage: "checkmark")
        } else if let icon = entry.icon {
            Label { Text(entry.label) } icon: { StructureIcon.image(icon) }
        } else {
            Text(entry.label)
        }
    }
}

/// `Content.MenuGroups` (`content.ts`): entries in groups, one submenu level.
private struct MenuGroupData: Decodable {
    let title: String?
    let entries: [MenuEntryData]
}

private struct MenuEntryData: Decodable {
    let id: String
    let label: String
    let icon: String?
    let destructive: Bool?
    let disabled: Bool?
    let checked: Bool?
    let entries: [MenuEntryData]?
}
