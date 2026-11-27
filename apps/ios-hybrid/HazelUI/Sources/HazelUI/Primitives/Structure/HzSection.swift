import SwiftUI

// Owned by lane S4. `hz:section`: a titled group of rows with header actions (`hz:action` children).
// Collapsible, its title is a disclosure raising `toggle`; reorderable, rows drag and raise `move` by key.
struct HzSection: View {
    let tree: Tree
    let node: Node

    @Environment(\.horizontalSizeClass) private var horizontalSizeClass

    var body: some View {
        let _ = RenderCounter.record(node.id)
        let sizeClass = HazelTheme.SizeClass(horizontalSizeClass)
        let look = node[prop: "style"]?.string ?? "sidebar"
        let root = HazelTheme.Recipes.section.style(part: nil, options: ["style": look], flags: [], states: [],
                                                     sizeClass: sizeClass)
        let title = node[prop: "title"]?.string ?? ""
        let collapsed = node[prop: "collapsed"]?.bool == true
        // The web lays the header and rows out as one wrapping row; `rowGap` separates every line.
        VStack(alignment: .leading, spacing: root.rowGap ?? 0) {
            SectionHeader(tree: tree, node: node, title: title, collapsible: node[prop: "collapsible"]?.bool == true,
                          collapsed: collapsed, look: look, sizeClass: sizeClass)
            if !collapsed {
                // A `list` section's rows run edge to edge, past its inset (as the web's bleed).
                SectionRows(tree: tree, node: node, reorderable: node[prop: "reorderable"]?.bool == true,
                            bleed: look == "list" ? root.paddingX ?? 0 : 0)
            }
        }
        .padding(.horizontal, root.paddingX ?? 0)
        .padding(.top, root.paddingTop ?? root.paddingY ?? 0)
        .padding(.bottom, root.paddingBottom ?? root.paddingY ?? 0)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
        .accessibilityLabel(title)
    }
}

/// The title (or its disclosure) and the header actions. Reads the child list for the actions, so
/// it, not the section, follows children.
private struct SectionHeader: View {
    let tree: Tree
    let node: Node
    let title: String
    let collapsible: Bool
    let collapsed: Bool
    let look: String
    let sizeClass: HazelTheme.SizeClass

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let actions = node.children.compactMap { tree.node($0) }.filter { $0.tag == "hz:action" }
        if !title.isEmpty || !actions.isEmpty {
            HStack(alignment: .center, spacing: 0) {
                if !title.isEmpty { titleView }
                ForEach(actions, id: \.id) { NodeView(tree: tree, node: $0) }
                    .environment(\.hzRoundAction, collapsible)
                    .environment(\.hzSectionAction, true)
            }
        }
    }

    private var titleView: some View {
        let recipe = HazelTheme.Recipes.section
        let style = recipe.style(part: "title", options: ["style": look], flags: [], states: [], sizeClass: sizeClass)
        return Group {
            if collapsible {
                Button {
                    tree.fire(node.id, "toggle", ["collapsed": .bool(!collapsed)])
                } label: {
                    disclosure(recipe.style(part: "disclosure", sizeClass: sizeClass),
                               chevron: recipe.style(part: "chevron", sizeClass: sizeClass))
                }
                .buttonStyle(.plain)
                .accessibilityValue(collapsed ? "Collapsed" : "Expanded")
                // Today's collapsible header (`sectionGroupHeader`): muted 12/20, pl-2.5, no gap below.
                .hzText(Self.collapsibleTitle(style), sizeClass)
                .padding(.leading, HazelTheme.space["2.5"] ?? 0)
            } else {
                Text(title).lineLimit(1).accessibilityAddTraits(.isHeader)
                    .hzText(style, sizeClass)
                    .padding(.horizontal, style.paddingX ?? 0)
                    .padding(.leading, style.paddingStart ?? 0)
                    .padding(.vertical, style.paddingY ?? 0)
                    .padding(.bottom, style.marginBottom ?? 0)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    /// The title's look when it is a disclosure, as the web renderer's `[data-collapsible]` rule.
    private static func collapsibleTitle(_ style: HazelTheme.Style) -> HazelTheme.Style {
        var out = style
        out.leading = HazelTheme.space["5"]
        out.color = HazelTheme.Colors.mutedFg
        return out
    }

    /// The chevron leads the title (`section-disclosure-leading`) and takes the title's ink.
    private func disclosure(_ style: HazelTheme.Style, chevron: HazelTheme.Style) -> some View {
        HStack(spacing: style.gap ?? 0) {
            StructureIcon.image("chevron-down")
                .resizable()
                .scaledToFit()
                .hzSize(chevron)
                .rotationEffect(.degrees(collapsed ? -90 : 0))
                .animation(controlAnimation(style, reduceMotion: reduceMotion), value: collapsed)
            Text(title).lineLimit(1)
        }
        .contentShape(Rectangle())
    }
}

/// The rows: every child but slots and header actions. Records itself as the section's child list
/// (G8), and with `reorderable` each row drags onto another to raise `move {id, before}`.
private struct SectionRows: View {
    let tree: Tree
    let node: Node
    let reorderable: Bool
    /// How far each `hz:item` row reaches past the section's inset on both sides.
    let bleed: CGFloat

    var body: some View {
        let _ = RenderCounter.recordList(node.id)
        let rows = node.children.compactMap { tree.node($0) }.filter { $0.tag != "hz:slot" && $0.tag != "hz:action" }
        ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
            if reorderable {
                // Rows are named by their key (`row-key`); an unkeyed row by its position.
                let key = row[prop: "key"]?.string ?? String(index)
                NodeView(tree: tree, node: row)
                    .draggable(key)
                    .dropDestination(for: String.self) { items, _ in
                        guard let id = items.first, id != key else { return false }
                        tree.fire(node.id, "move", ["id": .string(id), "before": .string(key)])
                        return true
                    }
            } else {
                NodeView(tree: tree, node: row).padding(.horizontal, row.tag == "hz:item" ? -bleed : 0)
            }
        }
    }
}
