import SwiftUI

// Owned by lane S1 (`docs/hazel-ui.md`, "Phase 2: lanes"). A picture whose box comes from `width` and
// `height` before it loads, kept in ratio and never wider than its container. Pressable on `press`.
struct HzImage: View {
    let tree: Tree
    let node: Node
    @Environment(\.horizontalSizeClass) private var horizontal

    var body: some View {
        let style = HazelTheme.Recipes.image.style(sizeClass: HazelTheme.SizeClass(horizontal))
        let width = node[prop: "width"]?.number.map { CGFloat($0) }
        let height = node[prop: "height"]?.number.map { CGFloat($0) }
        let alt = node[prop: "alt"]?.string ?? ""
        let pressable = node.events.contains("press")
        let shape = RoundedRectangle(cornerRadius: style.radius ?? 0, style: .continuous)
        let tree = tree, id = node.id
        ZStack {
            shape.fill(style.background?.color ?? .clear)
            if let src = node[prop: "src"]?.string { Picture(src: src) }
        }
        .modifier(ImageBox(width: width, height: height))
        .clipShape(shape)
        .contentShape(shape)
        .onTapGesture { if pressable { tree.fire(id, "press") } }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(alt)
        .accessibilityAddTraits(pressable ? .isButton : .isImage)
        .accessibilityHidden(alt.isEmpty && !pressable)
    }
}

/// The web's `max-width: 100%; height: auto` with `width`/`height` attributes: the given width, at
/// most the container's, at the given ratio.
private struct ImageBox: ViewModifier {
    let width: CGFloat?
    let height: CGFloat?

    func body(content: Content) -> some View {
        if let width, let height, width > 0, height > 0 {
            content
                .aspectRatio(width / height, contentMode: .fit)
                .frame(idealWidth: width, maxWidth: width)
        } else {
            content.frame(width: width, height: height)
        }
    }
}
