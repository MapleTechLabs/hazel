import UIKit

/// Text for bitmap rows: attributed strings with the web's line boxes (glyphs centred in the line
/// height, as CSS half-leading does), measurement, and the rects of ranges inside a laid-out block.
enum RowText {
    nonisolated(unsafe) private static var styles: [String: NSParagraphStyle] = [:]
    private static let lock = NSLock()

    static func paragraph(_ lineHeight: CGFloat, wrap: Bool) -> NSParagraphStyle {
        let key = "\(lineHeight)-\(wrap)"
        lock.lock()
        defer { lock.unlock() }
        if let hit = styles[key] { return hit }
        let p = NSMutableParagraphStyle()
        p.minimumLineHeight = lineHeight
        p.maximumLineHeight = lineHeight
        p.lineBreakMode = wrap ? .byWordWrapping : .byTruncatingTail
        styles[key] = p
        return p
    }

    static func attrs(_ font: UIFont, _ color: UIColor, lineHeight: CGFloat, wrap: Bool = true) -> [NSAttributedString.Key: Any] {
        [
            .font: font, .foregroundColor: color, .paragraphStyle: paragraph(lineHeight, wrap: wrap),
            .baselineOffset: (lineHeight - font.lineHeight) / 2,
        ]
    }

    static func string(_ text: String, _ font: UIFont, _ color: UIColor, lineHeight: CGFloat, wrap: Bool = true) -> NSAttributedString {
        NSAttributedString(string: text, attributes: attrs(font, color, lineHeight: lineHeight, wrap: wrap))
    }

    static func string(_ text: String, _ part: PartStyle, weight: Int? = nil, color: UIColor? = nil, wrap: Bool = true) -> NSAttributedString {
        string(text, part.font(weight: weight), color ?? part.ink ?? .label, lineHeight: part.lineHeight, wrap: wrap)
    }

    /// The size `text` takes within `width` (unbounded height).
    static func measure(_ text: NSAttributedString, width: CGFloat = .greatestFiniteMagnitude) -> CGSize {
        let r = text.boundingRect(
            with: CGSize(width: width, height: .greatestFiniteMagnitude),
            options: [.usesLineFragmentOrigin], context: nil
        )
        return CGSize(width: ceil(r.width), height: ceil(r.height))
    }

    /// Lays `text` out at `width` and returns its size and, per range, the rects it covers per line.
    static func layout(_ text: NSAttributedString, width: CGFloat, ranges: [NSRange]) -> (CGSize, [[CGRect]]) {
        let storage = NSTextStorage(attributedString: text)
        let manager = NSLayoutManager()
        let container = NSTextContainer(size: CGSize(width: width, height: .greatestFiniteMagnitude))
        container.lineFragmentPadding = 0
        manager.addTextContainer(container)
        storage.addLayoutManager(manager)
        manager.ensureLayout(for: container)
        let used = manager.usedRect(for: container)
        let rects = ranges.map { range -> [CGRect] in
            let glyphs = manager.glyphRange(forCharacterRange: range, actualCharacterRange: nil)
            var out: [CGRect] = []
            manager.enumerateEnclosingRects(
                forGlyphRange: glyphs, withinSelectedGlyphRange: NSRange(location: NSNotFound, length: 0), in: container
            ) { rect, _ in out.append(rect) }
            return out
        }
        return (CGSize(width: ceil(used.width), height: ceil(used.height)), rects)
    }
}
