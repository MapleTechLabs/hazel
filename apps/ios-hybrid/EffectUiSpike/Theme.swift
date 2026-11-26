import CoreText
import SwiftUI
import UIKit

/// Hazel's sidebar look as data (`docs/cross-platform-ui.md`, option B): the values the hybrid shell
/// measured from the web page (`web/look.ts`, light and dark), so the native screen matches the web's
/// without a page to read. The selected row's colours are `--sidebar-primary` / `--sidebar-primary-fg`
/// (`web-foldkit/src/core/styles/styles.css`), which no captured screen had.
enum Theme {
    static let screenBg = Color(light: "#fafafa", dark: "#111114")
    static let bandBorder = Color(light: "#09090b12", dark: "#ffffff12")
    static let pressedBg = Color(light: "#00000009", dark: "#ffffff0b")

    /// A channel or person row (`sidebarItem`, `web-foldkit/src/ui/sidebar.ts`).
    enum Row {
        static let height: CGFloat = 40
        static let radius: CGFloat = 8
        static let spacing: CGFloat = 2
        static let padLeading: CGFloat = 8
        static let iconSize: CGFloat = 20
        static let avatarSize: CGFloat = 24
        static let gap: CGFloat = 8
        static let label = Color(light: "#424245", dark: "#b2b2b3")
        static let labelEmphasized = Color(light: "#09090b", dark: "#fafafa")
        static let icon = Color(light: "#68686a", dark: "#8a8a8c")
        static let selectedBg = Color(light: "#9e77ed26", dark: "#9e77ed33")
        static let selectedFg = Color(light: "#6941c6", dark: "#d6bbfb")
        static let font = Inter.font(size: 16, weight: 500)
    }

    /// A section's header: chevron, title and its `+`.
    enum Section {
        static let padTop: CGFloat = 16
        static let headerHeight: CGFloat = 32
        static let padBottom: CGFloat = 16
        static let spacing: CGFloat = 2
        static let chevronLeading: CGFloat = 10
        static let chevronSize: CGFloat = 12
        static let actionSize: CGFloat = 14
        static let label = Color(light: "#52525c", dark: "#9f9fa9")
        static let font = Inter.font(size: 12, weight: 500)
    }

    enum Badge {
        static let bg = Color(hex: "#6938ef")
        static let fg = Color.white
        static let height: CGFloat = 20
        static let minWidth: CGFloat = 20
        static let padX: CGFloat = 6
        static let trailing: CGFloat = 6
        static let font = Inter.font(size: 11, weight: 500)
    }

    /// The web's own icon for a semantic `symbol` (`scripts/export-icons.ts`), else the SF Symbol.
    static func icon(_ symbol: String) -> Image {
        let asset = ["number": "hazel.hashtag", "lock": "hazel.lock", "plus": "hazel.plus"][symbol]
        if let asset, UIImage(named: asset) != nil { return Image(asset) }
        return Image(systemName: symbol)
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

    static func font(size: CGFloat, weight: Int) -> Font {
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
    /// `#rrggbb` or `#rrggbbaa`.
    init(hex: String) {
        self.init(uiColor: UIColor(hex: hex))
    }

    init(light: String, dark: String) {
        let light = UIColor(hex: light), dark = UIColor(hex: dark)
        self.init(uiColor: UIColor { $0.userInterfaceStyle == .dark ? dark : light })
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
