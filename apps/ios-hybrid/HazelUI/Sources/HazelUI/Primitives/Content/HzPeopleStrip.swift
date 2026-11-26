import SwiftUI

// Owned by lane S1 (`docs/hazel-ui.md`, "Phase 2: lanes"). Today's DMs strip (`mobile-dms.ts`): a
// snapping horizontal row of 56pt tiles, each a large avatar with presence over a first name, edge to
// edge (its own 16pt inset, past the screen's margins). A tile raises `press {id}`.
struct HzPeopleStrip: View {
    let tree: Tree
    let node: Node
    @Environment(\.horizontalSizeClass) private var horizontal

    struct Person: Identifiable {
        let id: String, label: String, name: String, initials: String
        let src: String?, presence: String?, emphasized: Bool
    }

    var body: some View {
        let _ = RenderCounter.record(node.id)
        let sizeClass = HazelTheme.SizeClass(horizontal)
        let people = (node[prop: "people"]?.array ?? []).compactMap(Self.person)
        let tree = tree, id = node.id
        ScrollView(.horizontal) {
            HStack(alignment: .top, spacing: 12) {
                ForEach(people) { person in
                    Button { tree.fire(id, "press", ["id": .string(person.id)]) } label: {
                        tile(person, sizeClass)
                    }
                    .buttonStyle(StripTileStyle())
                    .accessibilityLabel(HzAvatar.label(person.name, person.presence ?? "none"))
                }
            }
            .scrollTargetLayout()
            .padding(.horizontal, 16)
            .padding(.top, 16)
            .padding(.bottom, 4)
        }
        .scrollIndicators(.hidden)
        .scrollTargetBehavior(.viewAligned)
        .scrollClipDisabled()
        .accessibilityLabel("People")
    }

    private func tile(_ person: Person, _ sizeClass: HazelTheme.SizeClass) -> some View {
        let ink = person.emphasized ? HazelTheme.Colors.fg : HazelTheme.Colors.mutedFg
        let weight = person.emphasized ? HazelTheme.Font.weightSemibold : HazelTheme.Font.weightRegular
        let caption = HazelTheme.text(HazelTheme.TextStep.caption, sizeClass)
        var options = ["size": "large"]
        if let presence = person.presence { options["presence"] = presence }
        return VStack(spacing: 6) {
            AvatarFace(name: person.name, initials: person.initials, src: person.src, options: options,
                       sizeClass: sizeClass, side: 56)
            Text(person.label)
                .font(Inter.font(size: caption.size, weight: weight))
                .lineLimit(1)
                .truncationMode(.tail)
                .multilineTextAlignment(.center)
                .foregroundStyle(ink.color)
                .frame(width: 56, height: caption.lineHeight)
        }
        .frame(width: 56)
        .contentShape(Rectangle())
    }

    static func person(_ value: JSONValue) -> Person? {
        guard let o = value.object, let id = o["id"]?.string else { return nil }
        return Person(id: id, label: o["label"]?.string ?? "", name: o["name"]?.string ?? "",
                      initials: o["initials"]?.string ?? "", src: o["src"]?.string,
                      presence: o["presence"]?.string, emphasized: o["emphasized"]?.bool == true)
    }
}

/// The web's `active:opacity-60` over 100ms.
private struct StripTileStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .opacity(configuration.isPressed ? 0.6 : 1)
            .animation(.easeOut(duration: HazelTheme.duration["micro"] ?? 0.1), value: configuration.isPressed)
    }
}
