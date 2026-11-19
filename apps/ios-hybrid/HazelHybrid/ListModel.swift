import Foundation
import UIKit

/// The message list as the page captured it (`web/list-capture.ts`).
struct ListUpdate: Decodable, Sendable {
    let id: String
    let count: Int
    /// Whether the list holds the newest row: only then does it follow the end.
    let followsEnd: Bool
    let frame: ListRect
    let rows: [RowCapture]
    /// Every row's key in index order, when it changed (the window grew or slid).
    let order: [String]?
}

struct ListRect: Decodable, Equatable, Sendable {
    let x, y, w, h: CGFloat
    var cgRect: CGRect { CGRect(x: x, y: y, width: w, height: h) }
}

/// A row as a display list: what the web drew, where, in which font and colour.
struct RowCapture: Decodable, Sendable {
    struct Hit: Decodable, Sendable { let id: String; let x, y, w, h: CGFloat }
    struct Menu: Decodable, Sendable { let id: String; let props: JSONValue }
    let key: String
    let index: Int
    /// Where the row starts across the screen (the native list spans it; the web's is inset).
    let x: CGFloat
    let w, h: CGFloat
    let items: [DisplayItem]
    let hits: [Hit]
    let menu: Menu?
}

/// A display-list item, and the rounded box it is cut to (`clip`), if any.
struct DisplayItem: Decodable, Sendable {
    struct Font: Decodable, Sendable {
        let size: CGFloat
        let weight: Int
        let mono: Bool
        let color: String
        let tracking: CGFloat
    }
    struct Clip: Decodable, Sendable {
        let x, y, w, h, r: CGFloat
        var rect: CGRect { CGRect(x: x, y: y, width: w, height: h) }
    }
    enum Kind: Sendable {
        case box(bg: String, radius: CGFloat, border: String?, borderWidth: CGFloat)
        case text(String, Font)
        case image(key: String, radius: CGFloat)
        /// A picture by its source, drawn as CSS `object-fit` says (`cover`, `contain`, `fill`).
        case url(src: String, radius: CGFloat, fit: String)
        /// A framed page (an HTML render): not in the bitmap; the list shows it live (`FramePool`).
        case frame(src: String, radius: CGFloat)
    }
    let rect: CGRect
    let kind: Kind
    let clip: Clip?

    private enum Keys: String, CodingKey { case t, x, y, w, h, bg, radius, border, bw, s, f, key, src, fit, clip }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: Keys.self)
        rect = CGRect(
            x: try c.decode(CGFloat.self, forKey: .x),
            y: try c.decode(CGFloat.self, forKey: .y),
            width: try c.decode(CGFloat.self, forKey: .w),
            height: try c.decode(CGFloat.self, forKey: .h)
        )
        clip = try c.decodeIfPresent(Clip.self, forKey: .clip)
        switch try c.decode(String.self, forKey: .t) {
        case "box":
            kind = .box(
                bg: try c.decode(String.self, forKey: .bg),
                radius: try c.decode(CGFloat.self, forKey: .radius),
                border: try c.decodeIfPresent(String.self, forKey: .border),
                borderWidth: try c.decodeIfPresent(CGFloat.self, forKey: .bw) ?? 0
            )
        case "text":
            kind = .text(try c.decode(String.self, forKey: .s), try c.decode(Font.self, forKey: .f))
        case "frame":
            kind = .frame(src: try c.decode(String.self, forKey: .src), radius: try c.decode(CGFloat.self, forKey: .radius))
        case "image":
            kind = .image(key: try c.decode(String.self, forKey: .key), radius: try c.decode(CGFloat.self, forKey: .radius))
        default:
            kind = .url(
                src: try c.decode(String.self, forKey: .src),
                radius: try c.decode(CGFloat.self, forKey: .radius),
                fit: try c.decodeIfPresent(String.self, forKey: .fit) ?? "fill"
            )
        }
    }
}

extension RowCapture {
    /// The pictures the row draws, by source, with the largest size each is drawn at (points).
    var pictures: [(src: String, size: CGSize)] {
        items.compactMap { item in
            guard case let .url(src, _, _) = item.kind else { return nil }
            return (src, item.rect.size)
        }
    }

    /// The page's icons the row draws, by key.
    var iconKeys: [String] {
        items.compactMap { item in
            guard case let .image(key, _) = item.kind else { return nil }
            return key
        }
    }

    /// The framed pages in the row, where they are in it.
    var frames: [(src: String, rect: CGRect, radius: CGFloat)] {
        items.compactMap { item in
            guard case let .frame(src, radius) = item.kind else { return nil }
            return (src, item.rect, radius)
        }
    }
}

/// Draws a row's display list into a bitmap. Thread-safe: rows draw on a background queue.
enum RowRenderer {
    static func render(_ row: RowCapture, icons: [String: UIImage], images: [String: UIImage], scale: CGFloat) -> CGImage? {
        guard row.w > 0, row.h > 0 else { return nil }
        let format = UIGraphicsImageRendererFormat()
        format.scale = scale
        format.opaque = false
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: row.w, height: row.h), format: format)
        let image = renderer.image { context in
            let cg = context.cgContext
            for item in row.items {
                let rect = item.rect
                cg.saveGState()
                if let clip = item.clip {
                    UIBezierPath(roundedRect: clip.rect, cornerRadius: clip.r).addClip()
                }
                switch item.kind {
                case let .box(bg, radius, border, borderWidth):
                    let path = UIBezierPath(roundedRect: rect, cornerRadius: min(radius, rect.height / 2, rect.width / 2))
                    UIColor(css: bg).setFill()
                    path.fill()
                    if let border, borderWidth > 0 {
                        let inset = UIBezierPath(
                            roundedRect: rect.insetBy(dx: borderWidth / 2, dy: borderWidth / 2),
                            cornerRadius: max(0, min(radius, rect.height / 2) - borderWidth / 2)
                        )
                        inset.lineWidth = borderWidth
                        UIColor(css: border).setStroke()
                        inset.stroke()
                    }
                case let .text(string, font):
                    let uiFont = font.mono
                        ? UIFont.monospacedSystemFont(ofSize: font.size, weight: weight(font.weight))
                        : WebFont.uiFont(size: font.size, weight: font.weight)
                    let attributed = NSAttributedString(string: string, attributes: [
                        .font: uiFont,
                        .foregroundColor: UIColor(css: font.color),
                        .kern: font.tracking,
                    ])
                    // The web's line box, the glyphs centred in it as CSS centres them.
                    let y = rect.minY + (rect.height - uiFont.lineHeight) / 2
                    attributed.draw(at: CGPoint(x: rect.minX, y: y))
                case let .image(key, radius):
                    if let icon = icons[key] { clipped(rect, radius, cg) { icon.draw(in: rect) } }
                case let .url(src, radius, fit):
                    if let image = images[src] {
                        clipped(rect, radius, cg) { image.draw(in: fitted(image.size, in: rect, fit: fit)) }
                    }
                case .frame:
                    break
                }
                cg.restoreGState()
            }
        }
        return image.cgImage
    }

    /// Where a picture of `size` goes in `rect` under CSS `object-fit` (centred, as `object-position` defaults).
    private static func fitted(_ size: CGSize, in rect: CGRect, fit: String) -> CGRect {
        guard size.width > 0, size.height > 0, fit == "cover" || fit == "contain" || fit == "scale-down" else { return rect }
        let widthRatio = rect.width / size.width
        let heightRatio = rect.height / size.height
        var scale = fit == "cover" ? max(widthRatio, heightRatio) : min(widthRatio, heightRatio)
        if fit == "scale-down" { scale = min(scale, 1) }
        let drawn = CGSize(width: size.width * scale, height: size.height * scale)
        return CGRect(x: rect.midX - drawn.width / 2, y: rect.midY - drawn.height / 2, width: drawn.width, height: drawn.height)
    }

    private static func clipped(_ rect: CGRect, _ radius: CGFloat, _ context: CGContext, _ draw: () -> Void) {
        context.saveGState()
        if radius > 0 {
            UIBezierPath(roundedRect: rect, cornerRadius: min(radius, rect.width / 2)).addClip()
        }
        draw()
        context.restoreGState()
    }

    private static func weight(_ css: Int) -> UIFont.Weight {
        switch css {
        case ..<450: .regular
        case ..<550: .medium
        case ..<650: .semibold
        default: .bold
        }
    }
}

extension UIColor {
    /// `#rrggbbaa`, as `web/look.ts` resolves every CSS colour.
    convenience init(css: String) {
        let value = UInt64(css.dropFirst(), radix: 16) ?? 0
        self.init(
            red: CGFloat((value >> 24) & 0xFF) / 255,
            green: CGFloat((value >> 16) & 0xFF) / 255,
            blue: CGFloat((value >> 8) & 0xFF) / 255,
            alpha: CGFloat(value & 0xFF) / 255
        )
    }
}
