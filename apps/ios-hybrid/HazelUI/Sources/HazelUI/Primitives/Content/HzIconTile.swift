import SwiftUI

// Owned by lane S1 (`docs/hazel-ui.md`, "Phase 2: lanes"). The kit's `iconTile` (`md`): a 20pt glyph
// on a 40pt tinted, bordered square, per `tone`. The recipe's layers win over the kit's values below.
struct HzIconTile: View {
    let tree: Tree
    let node: Node
    @Environment(\.horizontalSizeClass) private var horizontal

    var body: some View {
        let _ = RenderCounter.record(node.id)
        let sizeClass = HazelTheme.SizeClass(horizontal)
        let tone = node[prop: "tone"]?.string ?? "neutral"
        let recipe = HazelTheme.Recipes.iconTile
        let root = Self.kit(tone).merged(recipe.style(options: ["tone": tone], sizeClass: sizeClass))
        let icon = HazelTheme.Style(size: 20).merged(recipe.style(part: "icon", options: ["tone": tone], sizeClass: sizeClass))
        let side = root.size ?? 40
        HazelIcon(name: node[prop: "name"]?.string ?? "", size: icon.size)
            .foregroundStyle(root.color?.color ?? Color.primary)
            .frame(width: side, height: side)
            .hzBox(root)
            .hzBorder(root)
            .accessibilityHidden(true)
    }

    /// `ui/icon-tile.ts`: `INTENT` (accent is the kit's `primary`) at `SIZE.md`.
    static func kit(_ tone: String) -> HazelTheme.Style {
        typealias C = HazelTheme.Colors
        let (fill, ink, border): (HazelTheme.ThemedColor, HazelTheme.ThemedColor, HazelTheme.ThemedColor) = switch tone {
        case "accent": (C.primary.alpha(0.05), C.primary, C.primary.alpha(0.1))
        case "danger": (C.danger.alpha(0.05), C.danger, C.danger.alpha(0.1))
        case "warning": (C.warningSubtle, C.warningSubtleFg, C.warning.alpha(0.2))
        case "success": (C.successSubtle, C.successSubtleFg, C.success.alpha(0.2))
        default: (C.secondary, C.mutedFg, C.border)
        }
        return HazelTheme.Style(background: fill, color: ink, borderColor: border, borderWidth: 1, radius: HazelTheme.radius["lg"], size: 40)
    }
}

extension HazelTheme.ThemedColor {
    /// The colour at `alpha` of its own opacity (Tailwind's `/10`).
    func alpha(_ alpha: Double) -> Self {
        .init(light: .init(light.r, light.g, light.b, light.a * alpha), dark: .init(dark.r, dark.g, dark.b, dark.a * alpha))
    }
}
