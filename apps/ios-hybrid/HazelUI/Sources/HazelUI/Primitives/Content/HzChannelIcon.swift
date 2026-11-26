import SwiftUI

// Owned by lane S1 (`docs/hazel-ui.md`, "Phase 2: lanes"). Today's `channelIcon` (`ui/channel-icon.ts`,
// size `sm` on the `bg` surface): the emoji, `#` or a lock, or a customer's logo; marks cut out of the
// background: a lock top left for a private customer channel, up to two Connect partners' logos and
// the sync provider's mark at the right. The recipe is a stub, so the kit's sizes are drawn here.
struct HzChannelIcon: View {
    let tree: Tree
    let node: Node
    @Environment(\.horizontalSizeClass) private var horizontal

    /// The kit's `sm`: a 20pt glyph on phones (16pt from `sm` up), 12pt marks.
    private struct Metrics {
        let glyph: CGFloat, emoji: CGFloat, mark: CGFloat, partner: CGFloat, lock: CGFloat
        let slack: CGFloat = 8, discord: CGFloat = 10
    }

    var body: some View {
        let _ = RenderCounter.record(node.id)
        let compact = HazelTheme.SizeClass(horizontal) == .compact
        let m = Metrics(glyph: compact ? 20 : 16, emoji: compact ? 16 : 14, mark: 12, partner: 12, lock: 8)
        let customer = node[prop: "customer"].flatMap(Self.logo)
        let partners = (node[prop: "partners"]?.array ?? []).compactMap(Self.logo).prefix(2)
        let isPrivate = node[prop: "private"]?.bool == true
        let sync = node[prop: "sync"]?.string.flatMap { $0 == "none" ? nil : $0 }
        let fill = HazelTheme.Colors.bg.color
        glyph(customer, isPrivate, m)
            .frame(width: m.glyph, height: m.glyph)
            .overlay(alignment: .topLeading) {
                if customer != nil, isPrivate {
                    HazelIcon(name: "lock", size: m.lock)
                        .frame(width: m.mark, height: m.mark)
                        .background(Circle().fill(fill))
                        .offset(x: -4, y: -4)
                }
            }
            .overlay(alignment: .bottomTrailing) {
                if !partners.isEmpty {
                    HStack(alignment: .bottom, spacing: -4) {
                        ForEach(Array(partners.enumerated()), id: \.offset) { _, partner in
                            LogoMark(name: partner.name, initials: partner.initials, src: partner.src, side: m.partner, radius: 2)
                                .padding(1.5)
                                .background(RoundedRectangle(cornerRadius: 3.5, style: .continuous).fill(fill))
                        }
                    }
                    .offset(x: 4 + 1.5, y: 2 + 1.5)
                }
            }
            .overlay(alignment: partners.isEmpty ? .bottomTrailing : .topTrailing) {
                if let sync {
                    // Slack's mark keeps its colours; Discord's takes its brand colour, as the web's.
                    HazelIcon(name: sync, size: sync == "slack" ? m.slack : m.discord)
                        .foregroundStyle(HazelTheme.Colors.discord.color)
                        .frame(width: m.mark, height: m.mark)
                        .background(Circle().fill(fill))
                        .offset(x: 4, y: partners.isEmpty ? 2 : -4)
                }
            }
            .accessibilityElement(children: .ignore)
            .accessibilityLabel(Self.label(isPrivate, partners.map(\.name), sync))
    }

    @ViewBuilder private func glyph(_ customer: Logo?, _ isPrivate: Bool, _ m: Metrics) -> some View {
        if let customer {
            LogoMark(name: customer.name, initials: customer.initials, src: customer.src, side: m.glyph)
        } else if let emoji = node[prop: "emoji"]?.string, !emoji.isEmpty {
            Text(verbatim: emoji).font(.system(size: m.emoji)).lineLimit(1).fixedSize()
        } else {
            HazelIcon(name: isPrivate ? "lock" : "hashtag", size: m.glyph)
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
