import CoreText
import SwiftUI

// A recipe's resolved `HazelTheme.Style` as SwiftUI, shared by every primitive (moved from the spike's
// `Theme.swift`). Values come only from the generated theme; this file adds none.

extension HazelTheme.SizeClass {
    public init(_ sizeClass: UserInterfaceSizeClass?) {
        self = sizeClass == .regular ? .regular : .compact
    }
}

extension HazelTheme.Style {
    /// Inter at the style's type step and weight (`strong`), for this size class.
    public func font(_ sizeClass: HazelTheme.SizeClass) -> SwiftUI.Font {
        let metrics = HazelTheme.text(text ?? .body, sizeClass)
        let weight = strong == true ? HazelTheme.Font.weightStrong : HazelTheme.Font.weightRegular
        return Inter.font(size: metrics.size, weight: weight)
    }

    /// The line box: `leading` when the recipe sets one, else the type step's line height.
    public func lineHeight(_ sizeClass: HazelTheme.SizeClass) -> CGFloat {
        leading ?? HazelTheme.text(text ?? .body, sizeClass).lineHeight
    }
}

extension View {
    /// A style's text: font, ink and a line box of the web's height (single-line labels).
    public func hzText(_ style: HazelTheme.Style, _ sizeClass: HazelTheme.SizeClass) -> some View {
        font(style.font(sizeClass))
            .hzMonospacedDigit(style.numeric == true)
            .foregroundStyle(style.color?.color ?? Color.primary)
            .frame(minHeight: style.lineHeight(sizeClass))
    }

    /// A style's box: padding, minimum height, fill, ring, corner radius, bottom divider, opacity.
    public func hzBox(_ style: HazelTheme.Style) -> some View {
        let shape = RoundedRectangle(cornerRadius: min(style.radius ?? 0, 1000), style: .continuous)
        return padding(.horizontal, style.paddingX ?? 0)
            .padding(.vertical, style.paddingY ?? 0)
            .frame(minHeight: style.minHeight)
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
        let name = switch weight {
        case ..<450: "Inter-Regular"
        case ..<550: "Inter-Medium"
        case ..<650: "Inter-SemiBold"
        default: "Inter-Bold"
        }
        return .custom(name, fixedSize: size)
    }
}
