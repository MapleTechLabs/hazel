import SwiftUI

// Owned by lane S1 (`docs/hazel-ui.md`, "Phase 2: lanes"). One of the web's icons in the current ink,
// at the size its container sets (`hzIconSize`), else the icons' own 18pt grid (`HazelIcon`).
// `tint` colours it (a saved view's colour, a `tint-*` token); `dot` draws a round mark half the
// icon's box wide instead of a glyph (`ph2-view-glyph`), in the box an icon gets wherever it is, the
// muted tint when it has none.
struct HzIcon: View {
    let tree: Tree
    let node: Node
    @Environment(\.hzIconSize) private var containerSize

    var body: some View {
        let tint = HzIcon.tint(node[prop: "tint"]?.string)
        if node[prop: "dot"]?.bool ?? false {
            let side = containerSize ?? HazelIcons.naturalSize
            Circle()
                .fill(tint ?? HazelTheme.Colors.tintMuted.color)
                .frame(width: side / 2, height: side / 2)
                .frame(width: side, height: side)
                .accessibilityHidden(true)
        } else if let tint {
            HazelIcon(name: node[prop: "name"]?.string ?? "").foregroundStyle(tint)
        } else {
            HazelIcon(name: node[prop: "name"]?.string ?? "")
        }
    }

    /// A `TabTint` name's colour token.
    static func tint(_ name: String?) -> Color? {
        switch name {
        case "muted": HazelTheme.Colors.tintMuted.color
        case "gray": HazelTheme.Colors.tintGray.color
        case "red": HazelTheme.Colors.tintRed.color
        case "orange": HazelTheme.Colors.tintOrange.color
        case "yellow": HazelTheme.Colors.tintYellow.color
        case "green": HazelTheme.Colors.tintGreen.color
        case "teal": HazelTheme.Colors.tintTeal.color
        case "blue": HazelTheme.Colors.tintBlue.color
        case "purple": HazelTheme.Colors.tintPurple.color
        case "pink": HazelTheme.Colors.tintPink.color
        default: nil
        }
    }
}
