import SwiftUI

extension EnvironmentValues {
    /// A ring an `hz:avatarStack` draws around each avatar, in the avatar's own shape.
    @Entry var hzAvatarRing: HazelTheme.ThemedColor? = nil
}

// Owned by lane S1 (`docs/hazel-ui.md`, "Phase 2: lanes"). Initials on the accent, or a picture over
// them; a presence dot or provider mark at the bottom right corner, a quarter outside. Pressable when
// the view handles `press`.
struct HzAvatar: View {
    let tree: Tree
    let node: Node
    @Environment(\.horizontalSizeClass) private var horizontal
    @Environment(\.hzAvatarRing) private var stackRing

    var body: some View {
        let sizeClass = HazelTheme.SizeClass(horizontal)
        let options = node.options(["size", "presence", "mark"])
        let recipe = HazelTheme.Recipes.avatar
        let root = recipe.style(options: options, sizeClass: sizeClass)
        let image = recipe.style(part: "image", options: options, sizeClass: sizeClass)
        let side = root.size ?? 20
        let shape = RoundedRectangle(cornerRadius: min(root.radius ?? 0, side / 2), style: .continuous)
        let presence = options["presence"] ?? "none"
        let mark = options["mark"] ?? "none"
        let pressable = node.events.contains("press")
        let tree = tree, id = node.id
        ZStack {
            shape.fill(root.background?.color ?? .clear)
            Text(node[prop: "initials"]?.string ?? "")
                .lineLimit(1)
                .fixedSize()
                .tracking(root.tracking(sizeClass))
                .hzText(root, sizeClass)
            if let src = node[prop: "src"]?.string {
                let imageSide = image.size ?? side
                Picture(src: src)
                    .frame(width: imageSide, height: imageSide)
                    .clipShape(RoundedRectangle(cornerRadius: min(image.radius ?? 0, imageSide / 2), style: .continuous))
            }
        }
        .frame(width: side, height: side)
        .overlay { if let ring = stackRing { shape.strokeBorder(ring.color, lineWidth: 1) } }
        .overlay(alignment: .bottomTrailing) {
            if presence != "none" { corner(recipe.style(part: "presence", options: options, sizeClass: sizeClass), dot: true) }
            else if mark != "none" { corner(recipe.style(part: "mark", options: options, sizeClass: sizeClass), glyph: mark) }
        }
        .contentShape(shape)
        .onTapGesture { if pressable { tree.fire(id, "press") } }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(Self.label(node[prop: "name"]?.string, presence))
        .accessibilityAddTraits(pressable ? .isButton : .isImage)
        .accessibilityHidden(!pressable && (node[prop: "name"]?.string ?? "").isEmpty)
    }

    /// A corner badge: its recipe box, offset a quarter of its size past the avatar's corner.
    private func corner(_ style: HazelTheme.Style, dot: Bool = false, glyph: String? = nil) -> some View {
        let side = style.size ?? 8
        let shape = RoundedRectangle(cornerRadius: min(style.radius ?? 0, side / 2), style: .continuous)
        return ZStack {
            shape.fill(style.background?.color ?? .clear)
            // CSS draws the border outermost and an inset ring just inside it.
            let border = style.borderColor == nil ? 0 : (style.borderWidth ?? 1)
            if let ring = style.ring { shape.inset(by: border).strokeBorder(ring.color, lineWidth: 1) }
            if let color = style.borderColor { shape.strokeBorder(color.color, lineWidth: border) }
            if let glyph { Glyph(name: glyph).foregroundStyle(style.color?.color ?? Color.primary) }
        }
        .frame(width: side, height: side)
        .offset(x: side / 4, y: side / 4)
    }

    static func label(_ name: String?, _ presence: String) -> String {
        let status = switch presence {
        case "online": "Online"
        case "away": "Away"
        case "busy": "Do not disturb"
        case "offline": "Offline"
        default: ""
        }
        return [name ?? "", status].filter { !$0.isEmpty }.joined(separator: ", ")
    }
}
