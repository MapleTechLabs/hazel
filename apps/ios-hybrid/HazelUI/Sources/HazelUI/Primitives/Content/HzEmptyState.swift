import SwiftUI
import UIKit

// Owned by lane S1 (`docs/hazel-ui.md`, "Phase 2: lanes"). A centred column: an illustration or an
// icon tile, the title, a description, then the `action` slot.
struct HzEmptyState: View {
    let tree: Tree
    let node: Node
    @Environment(\.horizontalSizeClass) private var horizontal

    var body: some View {
        let sizeClass = HazelTheme.SizeClass(horizontal)
        let recipe = HazelTheme.Recipes.emptyState
        let illustration = node[prop: "illustration"]?.string
        let options = illustration.map { ["illustration": $0] } ?? [:]
        let part = { (name: String?) in recipe.style(part: name, options: options, sizeClass: sizeClass) }
        let root = part(nil), tile = part("tile"), icon = part("icon"), content = part("content")
        let title = part("title"), description = part("description"), picture = part("illustration")
        let descriptionText = node[prop: "description"]?.string ?? ""
        VStack(alignment: .center, spacing: root.rowGap ?? 0) {
            if let illustration, illustration != "none" {
                Illustration(name: illustration)
                    .clipShape(RoundedRectangle(cornerRadius: picture.radius ?? 0, style: .continuous))
                    .opacity(picture.opacity ?? 1)
                    .padding(.bottom, picture.marginBottom ?? 0)
            }
            if let name = node[prop: "icon"]?.string {
                HazelIcon(name: name, size: icon.size ?? 24)
                    .foregroundStyle(tile.color?.color ?? Color.secondary)
                    .frame(width: tile.size ?? 48, height: tile.size ?? 48)
                    .hzBox(tile)
                    .hzBorder(tile)
                    .padding(.bottom, tile.marginBottom ?? 0)
                    .accessibilityHidden(true)
            }
            // Centred by the recipe's `textAlign`, else as the web's empty state draws it.
            Text(node[prop: "title"]?.string ?? "")
                .multilineTextAlignment(.center)
                .hzParagraph(Self.centred(title, root), sizeClass)
                .accessibilityAddTraits(.isHeader)
            if !descriptionText.isEmpty {
                Text(descriptionText)
                    .multilineTextAlignment(.center)
                    .hzParagraph(Self.centred(description, root), sizeClass)
                    .frame(maxWidth: 384)
                    .padding(.bottom, description.marginBottom ?? 0)
            }
            if tree.slot("action", of: node) != nil {
                HStack(alignment: .center, spacing: content.gap ?? 0) {
                    SlotView(tree: tree, node: node, name: "action")
                }
                .environment(\.hzInRow, true)
            }
        }
        .frame(maxWidth: .infinity)
        .padding(.vertical, root.paddingY ?? 0)
    }

    /// A text part with the root's `textAlign` when the part sets none (CSS inherits it).
    static func centred(_ part: HazelTheme.Style, _ root: HazelTheme.Style) -> HazelTheme.Style {
        var out = part
        out.textAlign = part.textAlign ?? root.textAlign ?? .center
        return out
    }
}

/// An `emptyIllustrations` picture from HazelUI's resources (`Resources/Illustrations`, copied from the
/// web app's `public/images` by `scripts/export-icons.ts`), over the muted fill. Square, at most 384pt.
private struct Illustration: View {
    let name: String

    @MainActor private static var cache: [String: UIImage] = [:]

    @MainActor static func image(_ name: String) -> UIImage? {
        if let hit = cache[name] { return hit }
        let url = Bundle.module.url(forResource: name, withExtension: "webp", subdirectory: "Illustrations")
        let image = url.flatMap { UIImage(contentsOfFile: $0.path) }
        cache[name] = image
        return image
    }

    var body: some View {
        let image = Self.image(name)
        HazelTheme.Colors.muted.color
            .overlay { if let image { Image(uiImage: image).resizable().scaledToFill() } }
            .aspectRatio(1, contentMode: .fit)
            .frame(maxWidth: 384)
            .accessibilityLabel(name == "squirrel" ? "A squirrel gazing at the ocean" : "")
    }
}
