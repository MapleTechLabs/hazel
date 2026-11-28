import SwiftUI

// Owned by lane S1 (`docs/hazel-ui.md`, "Phase 2: lanes"). Copy in a role and tone. Its text is its
// own text op and its `#text` children; a nested `hz:text` is an inline run in that run's own style,
// except a `kbd` one, which is a key cap in the line. `overline` is uppercase and tracked (Style).
struct HzText: View {
    let tree: Tree
    let node: Node
    @Environment(\.horizontalSizeClass) private var horizontal

    var body: some View {
        let _ = RenderCounter.record(node.id)
        let sizeClass = HazelTheme.SizeClass(horizontal)
        let style = Self.style(node, sizeClass)
        if Self.isKeyCap(node) {
            KeyCap(text: Self.runs(tree, node, sizeClass), style: style, sizeClass: sizeClass)
        } else if node.children.contains(where: { tree.node($0).map(Self.isKeyCap) == true }) {
            segments(style, sizeClass)
        } else {
            Self.runs(tree, node, sizeClass)
                .hzParagraph(style, sizeClass)
        }
    }

    static func isKeyCap(_ node: Node) -> Bool { node.tag == "hz:text" && node[prop: "role"]?.string == "kbd" }

    static func style(_ node: Node, _ sizeClass: HazelTheme.SizeClass) -> HazelTheme.Style {
        let options = node.options(["role", "tone"])
        let flags = Set(["strong", "numeric", "truncate", "clamp"].filter { node[prop: $0]?.bool == true })
        return HazelTheme.Recipes.text.style(options: options, flags: flags, sizeClass: sizeClass)
    }

    /// The line split at its key caps: runs of text between them, all on the first baseline.
    private func segments(_ style: HazelTheme.Style, _ sizeClass: HazelTheme.SizeClass) -> some View {
        var parts: [(id: Int, cap: Node?, text: Text)] = [(0, nil, Text(node.text))]
        for id in node.children {
            guard let child = tree.node(id) else { continue }
            if Self.isKeyCap(child) {
                parts.append((parts.count, child, Self.runs(tree, child, sizeClass)))
                parts.append((parts.count, nil, Text(verbatim: "")))
            } else {
                let last = parts.removeLast()
                parts.append((last.id, nil, Text("\(last.text)\(Self.run(tree, child, sizeClass))")))
            }
        }
        return HStack(alignment: .firstTextBaseline, spacing: 0) {
            ForEach(parts, id: \.id) { part in
                if let cap = part.cap {
                    KeyCap(text: part.text, style: Self.style(cap, sizeClass), sizeClass: sizeClass)
                } else {
                    part.text.hzParagraph(style, sizeClass)
                }
            }
        }
        .accessibilityElement(children: .combine)
    }

    /// The node's text as one `Text`: plain children as they are, nested texts styled on their own.
    static func runs(_ tree: Tree, _ node: Node, _ sizeClass: HazelTheme.SizeClass) -> Text {
        var out = Text(node.text)
        for id in node.children {
            guard let child = tree.node(id) else { continue }
            out = Text("\(out)\(run(tree, child, sizeClass))")
        }
        return out
    }

    private static func run(_ tree: Tree, _ child: Node, _ sizeClass: HazelTheme.SizeClass) -> Text {
        guard child.tag == "hz:text" else { return Text(tree.text(of: child)) }
        let style = style(child, sizeClass)
        var run = runs(tree, child, sizeClass).font(style.typeFont(sizeClass))
        if let color = style.color { run = run.foregroundStyle(color.color) }
        if style.numeric == true { run = run.monospacedDigit() }
        return run
    }
}

/// A `kbd` key cap: the recipe's raised box (border, shadow) around one line of its text.
struct KeyCap: View {
    let text: Text
    let style: HazelTheme.Style
    let sizeClass: HazelTheme.SizeClass

    var body: some View {
        text.lineLimit(1)
            .fixedSize()
            .tracking(style.tracking(sizeClass))
            .hzText(style, sizeClass)
            .hzBox(style)
            .hzBorder(style)
            .hzShadow(style)
    }
}
