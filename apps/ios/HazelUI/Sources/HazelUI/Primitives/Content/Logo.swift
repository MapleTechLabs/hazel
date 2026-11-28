import SwiftUI

/// An organization's or customer's mark (`content.ts` `Logo`, the web's `companyLogo`): its picture,
/// else its initials in semibold on a subtle tint picked by its name (FNV-1a, as the web's `tintIndex`).
struct LogoMark: View {
    let name: String
    let initials: String
    let src: String?
    let side: CGFloat
    var radius: CGFloat = HazelTheme.radius["sm"] ?? 4

    /// The web's `TINTS`: the theme's subtle pairs, then secondary.
    static let tints: [(HazelTheme.ThemedColor, HazelTheme.ThemedColor)] = [
        (HazelTheme.Colors.primarySubtle, HazelTheme.Colors.primarySubtleFg),
        (HazelTheme.Colors.infoSubtle, HazelTheme.Colors.infoSubtleFg),
        (HazelTheme.Colors.successSubtle, HazelTheme.Colors.successSubtleFg),
        (HazelTheme.Colors.warningSubtle, HazelTheme.Colors.warningSubtleFg),
        (HazelTheme.Colors.dangerSubtle, HazelTheme.Colors.dangerSubtleFg),
        (HazelTheme.Colors.secondary, HazelTheme.Colors.secondaryFg),
    ]

    static func tint(_ name: String) -> Int {
        var hash: UInt32 = 0x811c9dc5
        for scalar in name.trimmingCharacters(in: .whitespaces).lowercased().unicodeScalars {
            hash ^= scalar.value
            hash = hash &* 0x01000193
        }
        return Int(hash % UInt32(tints.count))
    }

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: radius, style: .continuous)
        let (fill, ink) = Self.tints[Self.tint(name)]
        ZStack {
            if let src {
                HazelTheme.Colors.secondary.color
                Picture(src: src)
            } else {
                fill.color
                // At 16pt two letters do not fit: the first only (the web's `2xs`).
                Text(side <= 16 ? String(initials.prefix(1)) : initials)
                    .font(Inter.font(size: side <= 20 ? 10 : 11, weight: HazelTheme.Font.weightSemibold))
                    .lineLimit(1)
                    .fixedSize()
                    .foregroundStyle(ink.color)
            }
        }
        .frame(width: side, height: side)
        .clipShape(shape)
        .accessibilityHidden(true)
    }
}
