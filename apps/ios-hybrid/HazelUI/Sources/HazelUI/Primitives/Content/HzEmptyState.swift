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
        // HAZEL-GAP(recipe-text-align): a recipe cannot centre text; the renderer does, as on the web.
        VStack(alignment: .center, spacing: root.rowGap ?? 0) {
            if let illustration, illustration != "none" {
                Illustration(name: illustration)
                    .clipShape(RoundedRectangle(cornerRadius: picture.radius ?? 0, style: .continuous))
                    .opacity(picture.opacity ?? 1)
                    .padding(.bottom, picture.marginBottom ?? 0)
            }
            if let name = node[prop: "icon"]?.string {
                Glyph(name: name)
                    .frame(width: icon.size ?? 24, height: icon.size ?? 24)
                    .foregroundStyle(tile.color?.color ?? Color.secondary)
                    .frame(width: tile.size ?? 48, height: tile.size ?? 48)
                    .hzBox(tile)
                    .hzBorder(tile)
                    .padding(.bottom, tile.marginBottom ?? 0)
                    .accessibilityHidden(true)
            }
            Text(node[prop: "title"]?.string ?? "")
                .multilineTextAlignment(.center)
                .hzParagraph(title, sizeClass)
                .accessibilityAddTraits(.isHeader)
            if !descriptionText.isEmpty {
                Text(descriptionText)
                    .multilineTextAlignment(.center)
                    .hzParagraph(description, sizeClass)
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
}

/// An `emptyIllustrations` picture: the web app's own asset when the app bundles it
/// (`squirrle_ocean.webp`), else its box in the muted fill. Square, at most 384pt (24rem) wide.
private struct Illustration: View {
    let name: String

    private static let assets = ["squirrel": "squirrle_ocean"]

    var body: some View {
        // HAZEL-GAP(illustration-asset): HazelUI has no resources; the app must bundle the picture.
        let image = Self.assets[name]
            .flatMap { Bundle.main.url(forResource: $0, withExtension: "webp") }
            .flatMap { UIImage(contentsOfFile: $0.path) }
        HazelTheme.Colors.muted.color
            .overlay { if let image { Image(uiImage: image).resizable().scaledToFill() } }
            .aspectRatio(1, contentMode: .fit)
            .frame(maxWidth: 384)
            .accessibilityLabel(name == "squirrel" ? "A squirrel gazing at the ocean" : "")
    }
}
