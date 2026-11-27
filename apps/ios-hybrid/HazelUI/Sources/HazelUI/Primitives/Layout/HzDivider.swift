import SwiftUI

// Owned by lane S1 (`docs/hazel-ui.md`, "Phase 2: lanes"). A hairline across its container.
struct HzDivider: View {
    let tree: Tree
    let node: Node
    @Environment(\.horizontalSizeClass) private var horizontal

    var body: some View {
        let style = HazelTheme.Recipes.divider.style(sizeClass: HazelTheme.SizeClass(horizontal))
        Rectangle()
            .fill(style.background?.color ?? .clear)
            .frame(height: style.minHeight ?? 1)
            .frame(maxWidth: style.fill == true ? .infinity : nil)
            .accessibilityHidden(true)
    }
}
