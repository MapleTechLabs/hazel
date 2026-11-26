import CoreText
import SwiftUI
import UIKit

// A recipe's resolved `HazelTheme.Style` as SwiftUI, shared by every primitive (moved from the spike's
// `Theme.swift`). Values come only from the generated theme; this file adds none.

extension HazelTheme.SizeClass {
    public init(_ sizeClass: UserInterfaceSizeClass?) {
        self = sizeClass == .regular ? .regular : .compact
    }
}

extension HazelTheme.Style {
    /// The weight drawn: `weight` (semibold, bold) over `strong` (medium) over regular.
    public var fontWeight: Int {
        weight ?? (strong == true ? HazelTheme.Font.weightStrong : HazelTheme.Font.weightRegular)
    }

    /// The code step (`Font.monoStep`), which draws in the system monospace as the web's `font.mono` does.
    public var isMono: Bool { (text ?? .body) == HazelTheme.Font.monoStep }

    /// Inter (or the system monospace for the code step) at the style's type step and weight.
    public func font(_ sizeClass: HazelTheme.SizeClass) -> SwiftUI.Font {
        let size = HazelTheme.text(text ?? .body, sizeClass).size
        if isMono { return .system(size: size, weight: Inter.systemWeight(fontWeight), design: .monospaced) }
        return Inter.font(size: size, weight: fontWeight)
    }

    /// The face `font(_:)` draws, for line metrics and bitmap text (system when Inter is not registered).
    public func uiFont(_ sizeClass: HazelTheme.SizeClass) -> UIFont {
        let size = HazelTheme.text(text ?? .body, sizeClass).size
        let weight = Inter.uiWeight(fontWeight)
        if isMono { return .monospacedSystemFont(ofSize: size, weight: weight) }
        return UIFont(name: Inter.faceName(fontWeight), size: size) ?? .systemFont(ofSize: size, weight: weight)
    }

    /// The line box: `leading` when the recipe sets one, else the type step's line height.
    public func lineHeight(_ sizeClass: HazelTheme.SizeClass) -> CGFloat {
        leading ?? HazelTheme.text(text ?? .body, sizeClass).lineHeight
    }

    /// The lines a text may take: one when it truncates or never wraps, else `lineClamp` (nil: any).
    public var lineLimit: Int? { truncate == true || nowrap == true ? 1 : lineClamp }

    /// The axes `overflow` scrolls (`scrollX`, `scrollY`), nil when the recipe leaves it to the view.
    public var scrollAxes: Axis.Set? {
        switch overflow {
        case .scrollX: .horizontal
        case .scrollY: .vertical
        case nil: nil
        }
    }

    /// `align` across a column (`start`, `center`, `end`); `fallback` when the recipe leaves it unset.
    public func horizontalAlignment(_ fallback: HorizontalAlignment = .leading) -> HorizontalAlignment {
        switch align {
        case .start: .leading
        case .center: .center
        case .end: .trailing
        case nil: fallback
        }
    }

    /// `align` across a row.
    public func verticalAlignment(_ fallback: VerticalAlignment = .top) -> VerticalAlignment {
        switch align {
        case .start: .top
        case .center: .center
        case .end: .bottom
        case nil: fallback
        }
    }

    /// `textAlign` for multi-line text.
    public var textAlignment: TextAlignment { textAlign == .center ? .center : .leading }
}

extension View {
    /// A style's text: font, ink and a line box of the web's height (single-line labels).
    public func hzText(_ style: HazelTheme.Style, _ sizeClass: HazelTheme.SizeClass) -> some View {
        font(style.font(sizeClass))
            .hzMonospacedDigit(style.numeric == true)
            .textCase(style.uppercase == true ? .uppercase : nil)
            .multilineTextAlignment(style.textAlignment)
            .hzLineLimit(style.lineClamp)
            .foregroundStyle(style.color?.color ?? Color.primary)
            .frame(minHeight: style.lineHeight(sizeClass))
    }

    /// A style's box: padding, minimum size, fill, ring, corner radius, bottom divider, opacity.
    public func hzBox(_ style: HazelTheme.Style) -> some View {
        let shape = RoundedRectangle(cornerRadius: min(style.radius ?? 0, 1000), style: .continuous)
        return padding(.horizontal, style.paddingX ?? 0)
            .padding(.vertical, style.paddingY ?? 0)
            .frame(minWidth: style.minWidth, minHeight: style.minHeight)
            .frame(maxWidth: style.fill == true ? .infinity : nil, alignment: .leading)
            .background(shape.fill(style.background?.color ?? .clear))
            .overlay { if let ring = style.ring { shape.strokeBorder(ring.color, lineWidth: 1) } }
            .overlay(alignment: .bottom) {
                if let divider = style.divider { Rectangle().fill(divider.color).frame(height: 1) }
            }
            .contentShape(shape)
            .opacity(style.opacity ?? 1)
    }

    /// A square of the style's `size` (an icon, an avatar, an icon-only control).
    @ViewBuilder public func hzSize(_ style: HazelTheme.Style) -> some View {
        if let size = style.size { frame(width: size, height: size) } else { self }
    }

    @ViewBuilder fileprivate func hzMonospacedDigit(_ on: Bool) -> some View {
        if on { monospacedDigit() } else { self }
    }

    /// `lineClamp` when the recipe sets one; otherwise an outer line limit stays in force.
    @ViewBuilder fileprivate func hzLineLimit(_ lines: Int?) -> some View {
        if let lines { lineLimit(lines).truncationMode(.tail) } else { self }
    }
}

/// Inter, the web's own font files. The app registers them once at launch (`register()`); unregistered,
/// SwiftUI falls back to the system font.
public enum Inter {
    /// Registers every `.ttf` in `folder` (default: the main bundle's `fonts`, from `scripts/fonts.py`).
    public static func register(from folder: URL? = Bundle.main.resourceURL?.appendingPathComponent("fonts")) {
        guard let folder, let files = try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)
        else { return }
        for file in files where file.pathExtension == "ttf" {
            CTFontManagerRegisterFontsForURL(file as CFURL, .process, nil)
        }
    }

    public static func font(size: CGFloat, weight: Int) -> SwiftUI.Font {
        .custom(faceName(weight), fixedSize: size)
    }

    /// The registered face for a CSS weight (400, 500, 600, 700).
    public static func faceName(_ weight: Int) -> String {
        switch weight {
        case ..<450: "Inter-Regular"
        case ..<550: "Inter-Medium"
        case ..<650: "Inter-SemiBold"
        default: "Inter-Bold"
        }
    }

    /// The system font's weight for a CSS weight, for the monospace and fallback faces.
    public static func systemWeight(_ weight: Int) -> SwiftUI.Font.Weight {
        switch weight {
        case ..<450: .regular
        case ..<550: .medium
        case ..<650: .semibold
        default: .bold
        }
    }

    /// `systemWeight` for UIKit.
    public static func uiWeight(_ weight: Int) -> UIFont.Weight {
        switch weight {
        case ..<450: .regular
        case ..<550: .medium
        case ..<650: .semibold
        default: .bold
        }
    }
}
