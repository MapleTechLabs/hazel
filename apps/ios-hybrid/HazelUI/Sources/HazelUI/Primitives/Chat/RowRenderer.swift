import UIKit

/// A row laid out for one width: its height and what to draw. Built and drawn off the main thread.
/// HAZEL-GAP(g7-tokens): metrics and colours are stand-ins until the message recipe exists.
public final class RowLayout: @unchecked Sendable {
    enum Item {
        case text(NSAttributedString, CGRect)
        case fill(CGRect, radius: CGFloat, color: UIColor)
        case stroke(CGRect, radius: CGFloat, color: UIColor)
        case line(CGRect, color: UIColor)
    }

    public let height: CGFloat
    let width: CGFloat
    let items: [Item]

    init(width: CGFloat, height: CGFloat, items: [Item]) {
        self.width = width
        self.height = height
        self.items = items
    }
}

/// Lays out and draws list entries: message rows (avatar, author and time, rich text, code blocks,
/// image placeholders, reactions), date and unread dividers. Pure, so any queue may call it.
public enum RowRenderer {
    static let side: CGFloat = 16
    static let avatar: CGFloat = 36
    static let gutter: CGFloat = 10
    static let traits = UITraitCollection(userInterfaceStyle: .light)

    static func color(_ c: UIColor) -> UIColor { c.resolvedColor(with: traits) }
    static let ink = color(.label)
    static let muted = color(.secondaryLabel)
    static let accent = color(.systemIndigo)
    static let wash = color(.systemGray6)
    static let border = color(.systemGray4)
    static let danger = color(.systemRed)

    static let body = UIFont.systemFont(ofSize: 15)
    static let bodyStrong = UIFont.systemFont(ofSize: 15, weight: .semibold)
    static let mono = UIFont.monospacedSystemFont(ofSize: 13, weight: .regular)
    static let caption = UIFont.systemFont(ofSize: 12)
    static let captionStrong = UIFont.systemFont(ofSize: 12, weight: .semibold)
    static let reactionFont = UIFont.systemFont(ofSize: 13, weight: .medium)

    nonisolated(unsafe) static let paragraph: NSParagraphStyle = {
        let p = NSMutableParagraphStyle()
        p.minimumLineHeight = 20
        p.maximumLineHeight = 20
        p.lineBreakMode = .byWordWrapping
        return p
    }()

    public static func layout(_ entry: ListEntry, width: CGFloat) -> RowLayout {
        switch entry {
        case let .message(row): message(row, width: width)
        case let .date(label): date(label, width: width)
        case .unread: unread(width: width)
        case .placeholder: RowLayout(width: width, height: 64, items: [])
        }
    }

    /// The height a placeholder takes until its row is known.
    public static let estimate: CGFloat = 64

    static func measure(_ text: NSAttributedString, width: CGFloat) -> CGSize {
        let r = text.boundingRect(
            with: CGSize(width: width, height: .greatestFiniteMagnitude),
            options: [.usesLineFragmentOrigin, .usesFontLeading],
            context: nil
        )
        return CGSize(width: ceil(r.width), height: ceil(r.height))
    }

    static func attributed(_ runs: [RowData.Run]) -> NSAttributedString {
        let out = NSMutableAttributedString()
        for run in runs {
            var attrs: [NSAttributedString.Key: Any] = [.font: body, .foregroundColor: ink, .paragraphStyle: paragraph]
            switch run.kind {
            case .plain: break
            case .strong: attrs[.font] = bodyStrong
            case .mention:
                attrs[.foregroundColor] = accent
                attrs[.font] = bodyStrong
                attrs[.backgroundColor] = accent.withAlphaComponent(0.1)
            case .link:
                attrs[.foregroundColor] = accent
                attrs[.underlineStyle] = NSUnderlineStyle.single.rawValue
            case .code:
                attrs[.font] = mono
                attrs[.backgroundColor] = wash
            }
            out.append(NSAttributedString(string: run.text, attributes: attrs))
        }
        return out
    }

    static func message(_ row: RowData, width: CGFloat) -> RowLayout {
        var items: [RowLayout.Item] = []
        let x = side + avatar + gutter
        let contentWidth = max(40, width - x - side)
        var y: CGFloat = row.grouped ? 2 : 10
        if !row.grouped {
            let circle = CGRect(x: side, y: y, width: avatar, height: avatar)
            items.append(.fill(circle, radius: avatar / 2, color: accent.withAlphaComponent(0.16)))
            let initials = NSAttributedString(string: row.initials ?? "", attributes: [.font: captionStrong, .foregroundColor: accent])
            let s = measure(initials, width: avatar)
            items.append(.text(initials, CGRect(x: circle.midX - s.width / 2, y: circle.midY - s.height / 2, width: s.width, height: s.height)))
            let header = NSMutableAttributedString(string: row.author ?? "", attributes: [.font: bodyStrong, .foregroundColor: ink])
            header.append(NSAttributedString(string: "  " + row.time, attributes: [.font: caption, .foregroundColor: muted]))
            let h = measure(header, width: contentWidth)
            items.append(.text(header, CGRect(x: x, y: y, width: contentWidth, height: h.height)))
            y += h.height + 2
        }
        for (index, block) in row.blocks.enumerated() {
            if index > 0 { y += 4 }
            switch block {
            case let .paragraph(runs, marker):
                var textX = x
                if let marker {
                    let m = NSAttributedString(string: marker, attributes: [.font: body, .foregroundColor: muted, .paragraphStyle: paragraph])
                    items.append(.text(m, CGRect(x: x, y: y, width: 20, height: 20)))
                    textX += 20
                }
                let text = attributed(runs)
                let s = measure(text, width: x + contentWidth - textX)
                items.append(.text(text, CGRect(x: textX, y: y, width: x + contentWidth - textX, height: s.height)))
                y += s.height
            case let .code(code, _):
                let text = NSAttributedString(string: code, attributes: [.font: mono, .foregroundColor: ink])
                let s = measure(text, width: contentWidth - 20)
                let box = CGRect(x: x, y: y + 2, width: contentWidth, height: s.height + 16)
                items.append(.fill(box, radius: 6, color: wash))
                items.append(.stroke(box, radius: 6, color: border))
                items.append(.text(text, CGRect(x: x + 10, y: y + 10, width: contentWidth - 20, height: s.height)))
                y += box.height + 4
            }
        }
        for image in row.images {
            let w = min(contentWidth, 260)
            let h = min(200, w * image.height / max(1, image.width))
            let box = CGRect(x: x, y: y + 6, width: w, height: h)
            items.append(.fill(box, radius: 8, color: wash))
            items.append(.stroke(box, radius: 8, color: border))
            y += h + 6
        }
        if !row.reactions.isEmpty {
            y += 6
            var px = x
            for reaction in row.reactions {
                let label = NSAttributedString(string: "\(reaction.emoji) \(reaction.count)", attributes: [.font: reactionFont, .foregroundColor: reaction.mine ? accent : ink])
                let s = measure(label, width: 200)
                let pill = CGRect(x: px, y: y, width: s.width + 16, height: 26)
                if pill.maxX > x + contentWidth, px > x { px = x; y += 30 }
                let placed = CGRect(x: px, y: y, width: pill.width, height: 26)
                items.append(.fill(placed, radius: 13, color: reaction.mine ? accent.withAlphaComponent(0.12) : wash))
                items.append(.stroke(placed, radius: 13, color: reaction.mine ? accent.withAlphaComponent(0.5) : border))
                items.append(.text(label, CGRect(x: placed.minX + 8, y: placed.midY - s.height / 2, width: s.width, height: s.height)))
                px = placed.maxX + 6
            }
            y += 26
        }
        return RowLayout(width: width, height: ceil(y + 4), items: items)
    }

    static func date(_ label: String, width: CGFloat) -> RowLayout {
        let text = NSAttributedString(string: label, attributes: [.font: captionStrong, .foregroundColor: muted])
        let s = measure(text, width: width)
        let mid: CGFloat = 20
        let textRect = CGRect(x: (width - s.width) / 2, y: mid - s.height / 2, width: s.width, height: s.height)
        return RowLayout(width: width, height: 40, items: [
            .line(CGRect(x: side, y: mid, width: textRect.minX - 10 - side, height: 1), color: border),
            .line(CGRect(x: textRect.maxX + 10, y: mid, width: width - side - textRect.maxX - 10, height: 1), color: border),
            .text(text, textRect),
        ])
    }

    static func unread(width: CGFloat) -> RowLayout {
        let text = NSAttributedString(string: "New", attributes: [.font: captionStrong, .foregroundColor: danger])
        let s = measure(text, width: width)
        let mid: CGFloat = 14
        return RowLayout(width: width, height: 28, items: [
            .line(CGRect(x: side, y: mid, width: width - side * 2 - s.width - 8, height: 1), color: danger),
            .text(text, CGRect(x: width - side - s.width, y: mid - s.height / 2, width: s.width, height: s.height)),
        ])
    }

    /// Draws a layout into a bitmap at `scale`. Thread-safe (UIKit string drawing off the main thread).
    public static func draw(_ layout: RowLayout, scale: CGFloat) -> CGImage? {
        guard layout.height > 0, layout.width > 0 else { return nil }
        let format = UIGraphicsImageRendererFormat()
        format.scale = scale
        format.opaque = true
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: layout.width, height: layout.height), format: format)
        let image = renderer.image { context in
            let cg = context.cgContext
            UIColor.white.setFill()
            cg.fill(CGRect(x: 0, y: 0, width: layout.width, height: layout.height))
            for item in layout.items {
                switch item {
                case let .text(text, rect):
                    text.draw(with: rect, options: [.usesLineFragmentOrigin, .usesFontLeading], context: nil)
                case let .fill(rect, radius, color):
                    color.setFill()
                    UIBezierPath(roundedRect: rect, cornerRadius: radius).fill()
                case let .stroke(rect, radius, color):
                    color.setStroke()
                    let path = UIBezierPath(roundedRect: rect.insetBy(dx: 0.25, dy: 0.25), cornerRadius: radius)
                    path.lineWidth = 0.5
                    path.stroke()
                case let .line(rect, color):
                    color.setFill()
                    cg.fill(CGRect(x: rect.minX, y: rect.minY, width: rect.width, height: 1 / scale))
                }
            }
        }
        return image.cgImage
    }
}
