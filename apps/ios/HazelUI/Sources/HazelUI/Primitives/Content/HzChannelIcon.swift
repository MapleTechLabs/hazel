import SwiftUI

// Owned by lane S1 (`docs/hazel-ui.md`, "Phase 2: lanes"). Today's `channelIcon` (`ui/channel-icon.ts`,
// size `sm`) from its recipe: the emoji, `#` or a lock, or a customer's logo; marks cut out of the page
// (`bg`): a lock top left for a private customer channel, up to two Connect partners' logos and the
// sync provider's mark at the right, at the web renderer's offsets.
struct HzChannelIcon: View {
    let tree: Tree
    let node: Node
    @Environment(\.horizontalSizeClass) private var horizontal

    /// The web renderer's own values: mark offsets, the partners' overlap and cut-out ring, Discord's logo.
    private static let out = HazelTheme.space["1"] ?? 4, drop = HazelTheme.space["0.5"] ?? 2
    private static let partnerRing: CGFloat = 1.5, discordLogo = HazelTheme.space["2.5"] ?? 10

    var body: some View {
        let _ = RenderCounter.record(node.id)
        let sizeClass = HazelTheme.SizeClass(horizontal)
        let options = node.options(["sync"])
        let isPrivate = node[prop: "private"]?.bool == true
        let recipe = HazelTheme.Recipes.channelIcon
        let part = { (name: String) in
            recipe.style(part: name, options: options, flags: isPrivate ? ["private"] : [], sizeClass: sizeClass)
        }
        let customer = node[prop: "customer"].flatMap(Self.logo)
        let partners = (node[prop: "partners"]?.array ?? []).compactMap(Self.logo).prefix(2)
        let sync = options["sync"].flatMap { $0 == "none" ? nil : $0 }
        let fill = HazelTheme.Colors.bg.color
        let lock = part("lock"), partner = part("partner"), mark = part("sync"), syncLogo = part("syncLogo")
        let side = part("glyph").size ?? 20
        glyph(customer, isPrivate, part, sizeClass)
            .frame(width: side, height: side)
            .overlay(alignment: .topLeading) {
                if customer != nil, isPrivate {
                    HazelIcon(name: "lock", size: part("lockIcon").size)
                        .frame(width: lock.size ?? 12, height: lock.size ?? 12)
                        .background(Circle().fill(lock.background?.color ?? fill))
                        .offset(x: -Self.out, y: -Self.out)
                }
            }
            .overlay(alignment: .bottomTrailing) {
                if !partners.isEmpty {
                    HStack(alignment: .bottom, spacing: -Self.out) {
                        ForEach(Array(partners.enumerated()), id: \.offset) { _, logo in
                            LogoMark(name: logo.name, initials: logo.initials, src: logo.src,
                                     side: partner.size ?? 12, radius: partner.radius ?? 4)
                                .padding(Self.partnerRing)
                                .background(RoundedRectangle(cornerRadius: (partner.radius ?? 4) + Self.partnerRing, style: .continuous).fill(fill))
                        }
                    }
                    .offset(x: Self.out + Self.partnerRing, y: Self.drop + Self.partnerRing)
                }
            }
            .overlay(alignment: partners.isEmpty ? .bottomTrailing : .topTrailing) {
                if let sync {
                    // Slack's mark keeps its colours; Discord's takes the recipe's brand colour.
                    HazelIcon(name: sync, size: sync == "discord" ? Self.discordLogo : syncLogo.size)
                        .foregroundStyle(syncLogo.color?.color ?? Color.primary)
                        .frame(width: mark.size ?? 12, height: mark.size ?? 12)
                        .background(Circle().fill(mark.background?.color ?? fill))
                        .offset(x: Self.out, y: partners.isEmpty ? Self.drop : -Self.out)
                }
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Self.label(isPrivate, partners.map(\.name), sync))
    }

    @ViewBuilder private func glyph(
        _ customer: Logo?, _ isPrivate: Bool, _ part: (String) -> HazelTheme.Style, _ sizeClass: HazelTheme.SizeClass
    ) -> some View {
        if let customer {
            let logo = part("logo")
            LogoMark(name: customer.name, initials: customer.initials, src: customer.src,
                     side: logo.size ?? 20, radius: logo.radius ?? 4)
        } else if let emoji = node[prop: "emoji"]?.string, !emoji.isEmpty {
            let style = part("emoji")
            Text(verbatim: emoji)
                .font(.system(size: HazelTheme.text(style.text ?? .body, sizeClass).size))
                .lineLimit(1)
                .fixedSize()
        } else {
            HazelIcon(name: isPrivate ? "lock" : "hashtag", size: part("glyph").size)
        }
    }

    struct Logo { let name: String, initials: String, src: String? }

    static func logo(_ value: JSONValue) -> Logo? {
        guard let object = value.object, let name = object["name"]?.string else { return nil }
        return Logo(name: name, initials: object["initials"]?.string ?? "", src: object["src"]?.string)
    }

    /// The marks' titles on the web, as one label (the channel's name is beside the icon).
    static func label(_ isPrivate: Bool, _ partners: [String], _ sync: String?) -> String {
        var parts: [String] = []
        if isPrivate { parts.append("Private channel") }
        if !partners.isEmpty { parts.append("Shared with \(partners.joined(separator: ", "))") }
        if let sync { parts.append(sync == "slack" ? "Synced with Slack" : "Synced with Discord") }
        return parts.joined(separator: ", ")
    }
}
