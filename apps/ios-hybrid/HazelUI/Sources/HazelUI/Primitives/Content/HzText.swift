import SwiftUI

// Owned by lane S1 (`docs/hazel-ui.md`, "Phase 2: lanes"). Copy in a role and tone. Its text is its
// own text op and its `#text` children; a nested `hz:text` is an inline run in that run's own style.
struct HzText: View {
    let tree: Tree
    let node: Node
    @Environment(\.horizontalSizeClass) private var horizontal

    var body: some View {
        let _ = RenderCounter.record(node.id)
        let sizeClass = HazelTheme.SizeClass(horizontal)
        let style = Self.style(node, sizeClass)
        Self.runs(tree, node, sizeClass)
            .hzParagraph(style, sizeClass)
    }

    static func style(_ node: Node, _ sizeClass: HazelTheme.SizeClass) -> HazelTheme.Style {
        let options = node.options(["role", "tone"])
        let flags = Set(["strong", "numeric", "truncate"].filter { node[prop: $0]?.bool == true })
        return HazelTheme.Recipes.text.style(options: options, flags: flags, sizeClass: sizeClass)
    }

    /// The node's text as one `Text`: plain children as they are, nested texts styled on their own.
    static func runs(_ tree: Tree, _ node: Node, _ sizeClass: HazelTheme.SizeClass) -> Text {
        var out = Text(node.text)
        for id in node.children {
            guard let child = tree.node(id) else { continue }
            if child.tag == "hz:text" {
                let style = style(child, sizeClass)
                var run = runs(tree, child, sizeClass).font(style.typeFont(sizeClass))
                if let color = style.color { run = run.foregroundStyle(color.color) }
                if style.numeric == true { run = run.monospacedDigit() }
                out = Text("\(out)\(run)")
            } else {
                out = Text("\(out)\(Text(tree.text(of: child)))")
            }
        }
        return out
    }
}
