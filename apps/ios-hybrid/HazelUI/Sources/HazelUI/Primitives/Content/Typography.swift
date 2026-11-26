import SwiftUI
import UIKit

// What lane S1's text needs beyond `hzText` (Tree/Styling.swift): tracking, and the web's line box on
// every line of wrapped text.

extension HazelTheme.Style {
    /// `font(_:)`; kept for the content views' runs (the code step's monospace is in `font` now).
    func typeFont(_ sizeClass: HazelTheme.SizeClass) -> SwiftUI.Font { font(sizeClass) }

    func tracking(_ sizeClass: HazelTheme.SizeClass) -> CGFloat {
        HazelTheme.text(text ?? .body, sizeClass).tracking
    }

    /// The leading CSS adds to the face's own line height to make the recipe's line box.
    func lineGap(_ sizeClass: HazelTheme.SizeClass) -> CGFloat {
        max(0, lineHeight(sizeClass) - uiFont(sizeClass).lineHeight)
    }
}

extension View {
    /// `hzText` for copy that may wrap: each line gets the recipe's line height, half the extra above
    /// and half below, as CSS does. `truncate` keeps it to one line, `lineClamp` to its count.
    func hzParagraph(_ style: HazelTheme.Style, _ sizeClass: HazelTheme.SizeClass) -> some View {
        let gap = style.lineGap(sizeClass)
        return font(style.typeFont(sizeClass))
            .tracking(style.tracking(sizeClass))
            .lineSpacing(gap)
            .lineLimit(style.lineLimit)
            .truncationMode(.tail)
            .padding(.vertical, gap / 2)
            .hzText(style, sizeClass)
    }
}
