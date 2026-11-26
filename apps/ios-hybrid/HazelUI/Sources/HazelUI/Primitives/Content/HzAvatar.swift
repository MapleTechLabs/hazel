import SwiftUI

extension EnvironmentValues {
    /// A ring an `hz:avatarStack` draws around each avatar, in the avatar's own shape.
    @Entry var hzAvatarRing: HazelTheme.ThemedColor? = nil
    /// A `pair`'s cutout instead: a ring of this width outside the avatar (the kit's `ring-2 ring-bg`).
    @Entry var hzAvatarCutout: CGFloat? = nil
    /// A side an `hz:avatarStack` `pair` sets on its avatars, over their recipe's size.
    @Entry var hzAvatarSide: CGFloat? = nil
}

// Owned by lane S1 (`docs/hazel-ui.md`, "Phase 2: lanes"). A picture, else the dithered tint seeded by
// the name (`avatar-seed-tint`) under the initials; a presence dot or provider mark at the bottom right
// corner, a quarter outside. Pressable when the view handles `press`.
struct HzAvatar: View {
    let tree: Tree
    let node: Node
    @Environment(\.horizontalSizeClass) private var horizontal

    var body: some View {
        let _ = RenderCounter.record(node.id)
        let options = node.options(["size", "presence", "mark"])
        let name = node[prop: "name"]?.string ?? ""
        let presence = options["presence"] ?? "none"
        let pressable = node.events.contains("press")
        let tree = tree, id = node.id
        AvatarFace(name: name, initials: node[prop: "initials"]?.string ?? "", src: node[prop: "src"]?.string,
                   options: options, sizeClass: HazelTheme.SizeClass(horizontal))
            .onTapGesture { if pressable { tree.fire(id, "press") } }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Self.label(name, presence))
            .accessibilityAddTraits(pressable ? .isButton : .isImage)
            .accessibilityHidden(!pressable && name.isEmpty)
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

/// The avatar's drawing, shared with `peopleStrip`: the recipe's shape at its size (or `side`), the
/// picture or the seeded dither (the accent when there is no name), and the corner badge.
struct AvatarFace: View {
    let name: String
    let initials: String
    let src: String?
    let options: [String: String]
    let sizeClass: HazelTheme.SizeClass
    var side: CGFloat? = nil
    @Environment(\.hzAvatarRing) private var stackRing
    @Environment(\.hzAvatarCutout) private var cutout
    @Environment(\.hzAvatarSide) private var stackSide

    var body: some View {
        let recipe = HazelTheme.Recipes.avatar
        let root = recipe.style(options: options, sizeClass: sizeClass)
        let image = recipe.style(part: "image", options: options, sizeClass: sizeClass)
        let natural = root.size ?? 20
        let side = side ?? stackSide ?? natural
        // A side over the recipe's scales the picture and corner radius with it.
        let scale = side / natural
        let shape = RoundedRectangle(cornerRadius: min((root.radius ?? 0) * scale, side / 2), style: .continuous)
        let seed = name.trimmingCharacters(in: .whitespaces)
        let presence = options["presence"] ?? "none"
        let mark = options["mark"] ?? "none"
        ZStack {
            if seed.isEmpty {
                shape.fill(root.background?.color ?? .clear)
                Text(initials)
                    .lineLimit(1)
                    .fixedSize()
                    .tracking(root.tracking(sizeClass))
                    .hzText(root, sizeClass)
            } else {
                // The web's dither face: the initials in semibold white at 46% of the side.
                DitherFill(seed: seed, side: side).clipShape(shape)
                Text(initials)
                    .font(Inter.font(size: side * 0.46, weight: HazelTheme.Font.weightSemibold))
                    .lineLimit(1)
                    .fixedSize()
                    .foregroundStyle(root.color?.color ?? .white)
            }
            if let src {
                let imageSide = (image.size ?? natural) * scale
                Picture(src: src)
                    .frame(width: imageSide, height: imageSide)
                    .clipShape(RoundedRectangle(cornerRadius: min((image.radius ?? 0) * scale, imageSide / 2), style: .continuous))
            }
        }
        .frame(width: side, height: side)
        .overlay {
            // The recipe's ring is inset (CSS `inset` box shadow); a pair's cutout sits outside.
            if let ring = stackRing {
                if let cutout { shape.inset(by: -cutout).strokeBorder(ring.color, lineWidth: cutout) }
                else { shape.strokeBorder(ring.color, lineWidth: 1) }
            }
        }
        .overlay(alignment: .bottomTrailing) {
            if presence != "none" {
                corner(Self.presenceStyle(recipe.style(part: "presence", options: options, sizeClass: sizeClass), presence))
            } else if mark != "none" {
                corner(recipe.style(part: "mark", options: options, sizeClass: sizeClass), glyph: mark)
            }
        }
        .contentShape(shape)
    }

    /// `presence-busy-tone`: busy is the `presence-busy` amber, as the kit draws it.
    static func presenceStyle(_ style: HazelTheme.Style, _ presence: String) -> HazelTheme.Style {
        guard presence == "busy" else { return style }
        var out = style
        out.background = HazelTheme.Colors.presenceBusy
        return out
    }

    /// A corner badge: its recipe box, offset a quarter of its size past the avatar's corner.
    private func corner(_ style: HazelTheme.Style, glyph: String? = nil) -> some View {
        let side = style.size ?? 8
        let shape = RoundedRectangle(cornerRadius: min(style.radius ?? 0, side / 2), style: .continuous)
        return ZStack {
            shape.fill(style.background?.color ?? .clear)
            // CSS draws the border outermost and an inset ring just inside it.
            let border = style.borderColor == nil ? 0 : (style.borderWidth ?? 1)
            if let ring = style.ring { shape.inset(by: border).strokeBorder(ring.color, lineWidth: 1) }
            if let color = style.borderColor { shape.strokeBorder(color.color, lineWidth: border) }
            if let glyph { HazelIcon(name: glyph, size: side).foregroundStyle(style.color?.color ?? Color.primary) }
        }
        .frame(width: side, height: side)
        .offset(x: side / 4, y: side / 4)
    }
}
