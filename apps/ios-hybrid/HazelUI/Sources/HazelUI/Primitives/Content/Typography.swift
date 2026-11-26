import SwiftUI
import UIKit

// What lane S1's text needs beyond `hzText` (Tree/Styling.swift): the code step's monospace face,
// tracking, and the web's line box on every line of wrapped text.

extension HazelTheme.Style {
    var isMono: Bool { (text ?? .body) == HazelTheme.Font.monoStep }

    /// `font(_:)`, except the code step, which the theme draws in the monospaced system font.
    func typeFont(_ sizeClass: HazelTheme.SizeClass) -> SwiftUI.Font {
        guard isMono else { return font(sizeClass) }
        let size = HazelTheme.text(text ?? .body, sizeClass).size
        return .system(size: size, weight: strong == true ? .medium : .regular, design: .monospaced)
    }

    func tracking(_ sizeClass: HazelTheme.SizeClass) -> CGFloat {
        HazelTheme.text(text ?? .body, sizeClass).tracking
    }

    /// The face SwiftUI draws for `typeFont`, for its line metrics (system when Inter is not registered).
    func uiFont(_ sizeClass: HazelTheme.SizeClass) -> UIFont {
        let size = HazelTheme.text(text ?? .body, sizeClass).size
        let weight = strong == true ? HazelTheme.Font.weightStrong : HazelTheme.Font.weightRegular
        if isMono { return .monospacedSystemFont(ofSize: size, weight: weight >= 500 ? .medium : .regular) }
        let name = weight < 450 ? "Inter-Regular" : weight < 550 ? "Inter-Medium" : weight < 650 ? "Inter-SemiBold" : "Inter-Bold"
        return UIFont(name: name, size: size) ?? .systemFont(ofSize: size, weight: weight >= 500 ? .medium : .regular)
    }

    /// The leading CSS adds to the face's own line height to make the recipe's line box.
    func lineGap(_ sizeClass: HazelTheme.SizeClass) -> CGFloat {
        max(0, lineHeight(sizeClass) - uiFont(sizeClass).lineHeight)
    }
}

extension View {
    /// `hzText` for copy that may wrap: each line gets the recipe's line height, half the extra above
    /// and half below, as CSS does. `truncate` keeps it to one line with an ellipsis.
    func hzParagraph(_ style: HazelTheme.Style, _ sizeClass: HazelTheme.SizeClass) -> some View {
        let gap = style.lineGap(sizeClass)
        return font(style.typeFont(sizeClass))
            .tracking(style.tracking(sizeClass))
            .lineSpacing(gap)
            .lineLimit(style.truncate == true || style.nowrap == true ? 1 : nil)
            .truncationMode(.tail)
            .padding(.vertical, gap / 2)
            .hzText(style, sizeClass)
    }
}
