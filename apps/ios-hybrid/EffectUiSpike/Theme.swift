import CoreText
import SwiftUI
import UIKit

/// How the `hz:*` views read Hazel's look: every value comes from the generated `HazelTheme`
/// (`HazelTheme.swift`, a link to `packages/ui/src/style/generated/Theme.swift`). This file only adds
/// the host's assets (Inter, the web's icons) and turns a recipe's resolved `Style` into SwiftUI.
enum Theme {
    /// Behind the screen, under the safe areas: the screen recipe's own background.
    static var screenBg: Color {
        HazelTheme.Recipes.screen.style(sizeClass: .compact).background?.color ?? .clear
    }

    /// The web's own icon for a semantic `symbol` (`scripts/export-icons.ts`), else the SF Symbol.
    static func icon(_ symbol: String) -> Image {
        let asset = ["hashtag": "hazel.hashtag", "number": "hazel.hashtag", "lock": "hazel.lock", "plus": "hazel.plus", "chevron-down": "hazel.chevron-down"][symbol]
        if let asset, UIImage(named: asset) != nil { return Image(asset) }
        return Image(systemName: symbol)
    }
}

extension HazelTheme.SizeClass {
    init(_ sizeClass: UserInterfaceSizeClass?) {
        self = sizeClass == .regular ? .regular : .compact
    }
}

extension HazelTheme.Style {
    /// Inter at the style's type step and weight (`strong`), for this size class.
    func font(_ sizeClass: HazelTheme.SizeClass) -> SwiftUI.Font {
        let metrics = HazelTheme.text(text ?? .body, sizeClass)
        let weight = strong == true ? HazelTheme.Font.weightStrong : HazelTheme.Font.weightRegular
        return Inter.font(size: metrics.size, weight: weight)
    }

    /// The line box: `leading` when the recipe sets one, else the type step's line height.
    func lineHeight(_ sizeClass: HazelTheme.SizeClass) -> CGFloat {
        leading ?? HazelTheme.text(text ?? .body, sizeClass).lineHeight
    }
}

extension View {
    /// A style's text: font, ink and a line box of the web's height (single-line labels).
    func hzText(_ style: HazelTheme.Style, _ sizeClass: HazelTheme.SizeClass) -> some View {
        font(style.font(sizeClass))
            .monospacedDigit(style.numeric == true)
            .foregroundStyle(style.color?.color ?? Color.primary)
            .frame(minHeight: style.lineHeight(sizeClass))
    }

    /// A style's box: padding, minimum height, fill, ring, corner radius, bottom divider, opacity.
    func hzBox(_ style: HazelTheme.Style) -> some View {
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
    @ViewBuilder func hzSize(_ style: HazelTheme.Style) -> some View {
        if let size = style.size { frame(width: size, height: size) } else { self }
    }

    @ViewBuilder fileprivate func monospacedDigit(_ on: Bool) -> some View {
        if on { monospacedDigit() } else { self }
    }
}

/// Inter, from the web's own font files (`scripts/fonts.py`).
enum Inter {
    static func register() {
        guard let folder = Bundle.main.resourceURL?.appendingPathComponent("fonts"),
              let files = try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)
        else { return }
        for file in files where file.pathExtension == "ttf" {
            CTFontManagerRegisterFontsForURL(file as CFURL, .process, nil)
        }
    }

    static func font(size: CGFloat, weight: Int) -> SwiftUI.Font {
        let name = switch weight {
        case ..<450: "Inter-Regular"
        case ..<550: "Inter-Medium"
        case ..<650: "Inter-SemiBold"
        default: "Inter-Bold"
        }
        return .custom(name, fixedSize: size)
    }
}

extension Color {
    /// `#rrggbb` or `#rrggbbaa`: only `Extensions.swift`'s G1 stand-in token colours still use it.
    init(hex: String) {
        self.init(uiColor: UIColor(hex: hex))
    }
}

extension UIColor {
    convenience init(hex: String) {
        var value: UInt64 = 0
        let digits = hex.trimmingCharacters(in: CharacterSet(charactersIn: "#"))
        Scanner(string: digits).scanHexInt64(&value)
        let hasAlpha = digits.count == 8
        let rgb = hasAlpha ? value >> 8 : value
        self.init(
            red: CGFloat((rgb >> 16) & 0xFF) / 255,
            green: CGFloat((rgb >> 8) & 0xFF) / 255,
            blue: CGFloat(rgb & 0xFF) / 255,
            alpha: hasAlpha ? CGFloat(value & 0xFF) / 255 : 1
        )
    }
}
