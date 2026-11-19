import CoreText
import SwiftUI

/// How the web draws a node (`web/look.ts`): the native views take their look from it, so a
/// converted screen looks like the web's, theme and all, from the one view.
struct Look: Decodable, Equatable {
    struct Box: Decodable, Equatable { let x, y, w, h: CGFloat }
    struct TextStyle: Decodable, Equatable {
        let color: String
        let size: CGFloat
        let weight: Int
        let lineHeight: CGFloat
        let tracking: CGFloat
        let x: CGFloat?
        let y: CGFloat?
    }
    struct Border: Decodable, Equatable { let color: String; let width: CGFloat }
    struct Icon: Decodable, Equatable {
        let x, size: CGFloat
        let color: String
        let radius: CGFloat
        /// The page's own SVG, rasterized (`WebBridge.icons`).
        let image: String?
        let avatar: Avatar?
    }
    struct Trailing: Decodable, Equatable { let right, size: CGFloat; let color: String; let image: String? }
    /// A thread row's line to its channel: the page's SVG, rasterized, placed outside the row's box.
    struct Branch: Decodable, Equatable { let x, y, w, h: CGFloat; let image: String }
    /// An avatar as the web draws it: a picture, or the dithered fill (colour, pattern, initial).
    struct Avatar: Decodable, Equatable {
        struct Initial: Decodable, Equatable {
            let color: String
            let size: CGFloat
            let weight: Int
            let char: String
        }
        let src: String?
        let bg: String?
        let pattern: String?
        let initial: Initial?
    }
    struct Badge: Decodable, Equatable {
        let color: String
        let size: CGFloat
        let weight: Int
        let bg: String
        let right, h, minW, radius, padX: CGFloat
    }
    struct Band: Decodable, Equatable {
        let box: Box
        let bg: String
        let borderTop: String?
        let borderBottom: String?
    }

    let box: Box
    let bg: String?
    let radius: CGFloat?
    let border: Border?
    let pressedBg: String?
    let label: TextStyle?
    let subtitle: TextStyle?
    let icon: Icon?
    let iconY: CGFloat?
    let trailing: Trailing?
    let branch: Branch?
    let badge: Badge?
    let band: Band?
}

extension Color {
    /// `#rrggbbaa`, as `web/look.ts` resolves every CSS colour.
    init(css: String?) {
        guard let css, css.hasPrefix("#"), let value = UInt64(css.dropFirst(), radix: 16) else {
            self = .clear
            return
        }
        self = Color(
            .sRGB,
            red: Double((value >> 24) & 0xFF) / 255,
            green: Double((value >> 16) & 0xFF) / 255,
            blue: Double((value >> 8) & 0xFF) / 255,
            opacity: Double(value & 0xFF) / 255
        )
    }
}

/// The web's font, from the same files (`scripts/fonts.py` turns `@fontsource/inter` into TTFs).
enum WebFont {
    static func register() {
        guard let folder = Bundle.main.resourceURL?.appendingPathComponent("fonts"),
              let files = try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)
        else { return }
        for file in files where file.pathExtension == "ttf" {
            CTFontManagerRegisterFontsForURL(file as CFURL, .process, nil)
        }
    }

    static func font(size: CGFloat, weight: Int) -> Font {
        .custom(name(weight), fixedSize: size)
    }

    static func uiFont(size: CGFloat, weight: Int) -> UIFont {
        UIFont(name: name(weight), size: size) ?? .systemFont(ofSize: size)
    }

    private static func name(_ weight: Int) -> String {
        switch weight {
        case ..<450: "Inter-Regular"
        case ..<550: "Inter-Medium"
        case ..<650: "Inter-SemiBold"
        default: "Inter-Bold"
        }
    }
}

extension Text {
    /// This text as the web sets it.
    func web(_ style: Look.TextStyle) -> some View {
        font(WebFont.font(size: style.size, weight: style.weight))
            .tracking(style.tracking)
            .foregroundStyle(Color(css: style.color))
    }
}
