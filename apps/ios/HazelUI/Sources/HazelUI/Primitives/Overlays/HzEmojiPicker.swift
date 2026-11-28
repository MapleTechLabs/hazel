import SwiftUI

// `hz:emojiPicker` on iOS (lane S3): iOS offers no emoji picker but the keyboard's, so it is a
// system sheet (medium and large detents) holding a search field over the categories, as the emoji
// keyboard lays them out. A pick raises `select`, a swipe down `dismiss`. In place it draws the panel,
// fading in (`fadeIn`); the presented sheet keeps the system's slide.
struct HzEmojiPicker: View {
    let tree: Tree
    let node: Node
    @Environment(\.horizontalSizeClass) private var horizontal

    /// The web's renderer-owned panel height (24rem, `focus/surface.ts`) in place.
    private static let inPlaceHeight: CGFloat = 384

    var body: some View {
        let sizeClass = HazelTheme.SizeClass(horizontal)
        let recipe = HazelTheme.Recipes.emojiPicker
        let panel = recipe.style(part: "panel", sizeClass: sizeClass)
        if node.overlayInPlace {
            if node[prop: "open"]?.bool == true {
                EmojiPanel(tree: tree, node: node, sizeClass: sizeClass, columns: .fixed)
                    .frame(height: Self.inPlaceHeight)
                    .hzOverlayPanel(panel)
                    .hzEnter("emojiPicker", part: "panel", sizeClass: sizeClass)
            }
        } else {
            Color.clear.frame(width: 0, height: 0)
                .sheet(isPresented: overlayDismissBinding(tree, node, node[prop: "open"]?.bool == true)) {
                    EmojiPanel(tree: tree, node: node, sizeClass: sizeClass, columns: .adaptive)
                        .hzBox(panel.merged(HazelTheme.Style(background: HazelTheme.Colors.clear, radius: 0)))
                        .presentationDetents([.medium, .large])
                        .presentationDragIndicator(.visible)
                        .presentationBackground(HazelTheme.Colors.bg.color)
                }
        }
    }
}

private struct EmojiPanel: View {
    enum Columns { case fixed, adaptive }

    let tree: Tree
    let node: Node
    let sizeClass: HazelTheme.SizeClass
    let columns: Columns
    @State private var query = ""

    /// The web's renderer-owned eight columns (`focus/surface.ts`).
    private static let columnCount = 8

    var body: some View {
        let recipe = HazelTheme.Recipes.emojiPicker
        let panel = recipe.style(part: "panel", sizeClass: sizeClass)
        let search = recipe.style(part: "search", sizeClass: sizeClass)
        let category = recipe.style(part: "category", sizeClass: sizeClass)
        let title = recipe.style(part: "categoryTitle", sizeClass: sizeClass)
        let emoji = recipe.style(part: "emoji", sizeClass: sizeClass)
        let empty = recipe.style(part: "empty", sizeClass: sizeClass)
        let size = emoji.size ?? 0
        let grid: [GridItem] = switch columns {
        case .fixed: Array(repeating: GridItem(.fixed(size), spacing: 0), count: Self.columnCount)
        case .adaptive: [GridItem(.adaptive(minimum: size), spacing: 0)]
        }
        let categories = OverlayEmojiData.search(query)
        VStack(alignment: .leading, spacing: panel.rowGap ?? 0) {
            TextField("Search emoji", text: $query)
                .textFieldStyle(.plain)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
                .hzText(search, sizeClass)
                .hzBox(search)
                .accessibilityLabel("Search emoji")
            ScrollView {
                LazyVStack(alignment: .leading, spacing: category.rowGap ?? 0) {
                    ForEach(categories, id: \.label) { each in
                        VStack(alignment: .leading, spacing: 0) {
                            Text(each.label).hzText(title, sizeClass).hzBox(title).accessibilityAddTraits(.isHeader)
                            LazyVGrid(columns: grid, alignment: .leading, spacing: 0) {
                                ForEach(each.emojis, id: \.emoji) { item in
                                    Button {
                                        tree.fire(node.id, "select", ["emoji": .string(item.emoji)])
                                    } label: {
                                        Text(item.emoji)
                                            .font(.system(size: HazelTheme.text(emoji.text ?? .title, sizeClass).size))
                                            .frame(width: size, height: size)
                                            .contentShape(RoundedRectangle(cornerRadius: emoji.radius ?? 0, style: .continuous))
                                    }
                                    .buttonStyle(.plain)
                                    .accessibilityLabel(item.name)
                                }
                            }
                        }
                        .accessibilityElement(children: .contain)
                        .accessibilityLabel(each.label)
                    }
                    if categories.isEmpty {
                        Text("No emoji found").hzText(empty, sizeClass).hzBox(empty).frame(maxWidth: .infinity)
                    }
                }
            }
            .scrollIndicators(.hidden)
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Emoji picker")
    }
}
