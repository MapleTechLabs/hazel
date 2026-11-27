import SwiftUI

// Owned by lane S1 (`docs/hazel-ui.md`, "Phase 2: lanes"). Today's DMs strip (`mobile-dms.ts`) from
// its recipe: a snapping row of tiles, each a seeded avatar with a cut-out presence dot over a first
// name, edge to edge past the screen's margins. A tile raises `press {id}`.
struct HzPeopleStrip: View {
    let tree: Tree
    let node: Node
    @Environment(\.horizontalSizeClass) private var horizontal

    struct Person: Identifiable {
        let id: String, label: String, name: String, initials: String
        let src: String?, presence: String?, emphasized: Bool
    }

    /// The web renderer's own values: the strip's top and bottom padding.
    private static let paddingTop = HazelTheme.space["4"] ?? 16, paddingBottom = HazelTheme.space["1"] ?? 4

    var body: some View {
        let _ = RenderCounter.record(node.id)
        let sizeClass = HazelTheme.SizeClass(horizontal)
        let recipe = HazelTheme.Recipes.peopleStrip
        let root = recipe.style(sizeClass: sizeClass)
        let people = (node[prop: "people"]?.array ?? []).compactMap(Self.person)
        let tree = tree, id = node.id
        ScrollView(.horizontal) {
            HStack(alignment: .top, spacing: root.gap ?? 0) {
                ForEach(people) { person in
                    Button { tree.fire(id, "press", ["id": .string(person.id)]) } label: {
                        StripTile(person: person, recipe: recipe, sizeClass: sizeClass)
                    }
                    .buttonStyle(StripTileStyle())
                    .accessibilityLabel(HzAvatar.label(person.label, person.presence ?? "none"))
                }
            }
            .scrollTargetLayout()
            .padding(.horizontal, root.paddingX ?? 0)
            .padding(.top, Self.paddingTop)
            .padding(.bottom, Self.paddingBottom)
        }
        .scrollIndicators(.hidden)
        .scrollTargetBehavior(.viewAligned)
        .scrollClipDisabled()
        .accessibilityLabel("People")
    }

    static func person(_ value: JSONValue) -> Person? {
        guard let o = value.object, let id = o["id"]?.string else { return nil }
        return Person(id: id, label: o["label"]?.string ?? "", name: o["name"]?.string ?? "",
                      initials: o["initials"]?.string ?? "", src: o["src"]?.string,
                      presence: o["presence"]?.string, emphasized: o["emphasized"]?.bool == true)
    }
}

/// One tile: the recipe's avatar (picture, else the dither under the first letter, else the initials)
/// over its label; the label is `fg` and semibold when emphasized, as the web renderer sets it.
private struct StripTile: View {
    let person: HzPeopleStrip.Person
    let recipe: HazelTheme.Recipe
    let sizeClass: HazelTheme.SizeClass

    var body: some View {
        let part = { (name: String) in recipe.style(part: name, sizeClass: sizeClass) }
        let tile = part("tile"), avatar = part("avatar"), initials = part("initials"), label = part("label")
        let side = avatar.size ?? 56
        let shape = RoundedRectangle(cornerRadius: avatar.radius ?? 0, style: .continuous)
        let seed = person.name.trimmingCharacters(in: .whitespaces)
        VStack(spacing: tile.rowGap ?? 0) {
            ZStack {
                shape.fill(avatar.background?.color ?? .clear)
                if !seed.isEmpty {
                    DitherFill(seed: seed, side: side).clipShape(shape)
                    DitherInitial(seed: seed, side: side)
                } else {
                    Text(verbatim: person.initials).lineLimit(1).fixedSize().hzText(initials, sizeClass)
                }
                if let src = person.src { Picture(src: src).clipShape(shape) }
            }
            .frame(width: side, height: side)
            .overlay(alignment: .bottomTrailing) {
                if let presence = person.presence, presence != "none" {
                    PresenceDot(presence: presence, style: part("presence"))
                }
            }
            Text(verbatim: person.label)
                .truncationMode(.tail)
                .hzText(Self.emphasized(label, person.emphasized), sizeClass)
                .lineLimit(1)
                .frame(width: side)
        }
        .frame(width: side)
        .contentShape(Rectangle())
    }

    static func emphasized(_ style: HazelTheme.Style, _ on: Bool) -> HazelTheme.Style {
        guard on else { return style }
        var out = style
        out.color = HazelTheme.Colors.fg
        out.weight = HazelTheme.Font.weightSemibold
        return out
    }
}

/// The web renderer's dot: the recipe's disc in the status colour, cut from the page by a 2.5pt ring,
/// a quarter outside the corner; offline is a hollow 2pt ring.
private struct PresenceDot: View {
    let presence: String
    let style: HazelTheme.Style

    private typealias C = HazelTheme.Colors

    var body: some View {
        let side = style.size ?? 12
        let fill: HazelTheme.ThemedColor = switch presence {
        case "online": C.presenceOnline
        case "away": C.presenceAway
        case "busy": C.presenceBusy
        default: C.bg
        }
        Circle().fill(fill.color)
            .overlay { if presence == "offline" { Circle().strokeBorder(C.presenceOffline.color, lineWidth: 2) } }
            .frame(width: side, height: side)
            .background(Circle().fill(C.bg.color).padding(-2.5))
            .offset(x: side / 4, y: side / 4)
    }
}

/// The web's `active:opacity-60` over 100ms (the `micro` duration, the default curve).
private struct StripTileStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        StripTilePress(configuration: configuration)
    }
}

private struct StripTilePress: View {
    let configuration: ButtonStyleConfiguration
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        configuration.label
            .opacity(configuration.isPressed ? 0.6 : 1)
            .animation(controlAnimation(HazelTheme.duration["micro"], ease: "standard", reduceMotion: reduceMotion), value: configuration.isPressed)
    }
}
