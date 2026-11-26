import SwiftUI
import UIKit

/// Lays out list entries and the chat leaves from the generated theme (`HazelTheme.Recipes`): message
/// rows (reply, avatar, header, rich text, attachments, link cards, reactions, thread card, failure),
/// date and unread dividers, and the standalone reaction bar, attachment grid and link card. Pure, so
/// any queue may call it. Geometry the recipes cannot say mirrors `web/primitives/chat/styles.ts`.
public enum RowRenderer {
    /// The height a placeholder takes until its row is known.
    public static let estimate: CGFloat = 64

    // MARK: entry points

    public static func layout(_ entry: ListEntry, _ context: RowContext) -> RowLayout {
        switch entry {
        case let .message(row): message(row, context)
        case let .date(label): divider(kind: "date", label: label, context)
        case let .unread(label): divider(kind: "unread", label: label, context)
        case .placeholder: RowLayout(width: context.width, height: estimate, items: [], background: background(context))
        }
    }

    /// G7's entry point: light, compact, at 3x.
    public static func layout(_ entry: ListEntry, width: CGFloat) -> RowLayout {
        layout(entry, RowContext(width: width))
    }

    public static func draw(_ layout: RowLayout, scale: CGFloat) -> CGImage? { layout.draw(scale: scale) }

    /// The list's own background, under every row.
    static func background(_ c: RowContext) -> UIColor { HazelTheme.Colors.bg.ui(c.dark) }

    // MARK: message

    /// One message row, `chat/message/row.ts` as A5 draws it, top to bottom.
    public static func message(_ row: RowData, _ c: RowContext) -> RowLayout {
        var b = Builder(c)
        let recipe = HazelTheme.Recipes.message
        let flags = Set(RowData.Flags.names.filter { row.flags.contains($0.1) }.map(\.0) + (row.grouped ? ["grouped"] : []))
        let root = PartStyle(recipe, nil, c, flags: flags)
        let pinned = row.flags.contains(.pinned)
        // `mt-2` on a group's first row, none on a grouped one.
        let top = row.grouped ? 0 : Token.space("2")
        let edge = pinned ? Token.space("1") : 0
        let left = edge + (pinned ? Token.space("2") : root.style.paddingX ?? 0)
        let right = root.style.paddingX ?? 0
        let padY = root.style.paddingY ?? 0
        let boxIndex = b.items.count
        var y = top + padY
        let x0 = left

        if let reply = row.reply { y = replyLine(reply, x: x0, y: y, &b) + Token.space("1") }

        let main = PartStyle(recipe, "main", c, flags: flags)
        let avatarStyle = PartStyle(recipe, "avatarImage", c)
        let avatarSize = avatarStyle.style.size ?? Token.space("10")
        let gap = main.style.gap ?? Token.space("4")
        let bodyX = x0 + avatarSize + gap
        let bodyWidth = max(40, c.width - right - bodyX)
        let mainTop = y
        let pending = main.style.opacity.map { $0 < 1 } ?? false
        if pending { b.items.append(.begin(alpha: main.style.opacity ?? 1)) }

        if row.showsHeader {
            let rect = CGRect(x: x0, y: y, width: avatarSize, height: avatarSize)
            avatar(row.initials ?? "", seed: row.author, rect: rect, style: avatarStyle, &b)
            b.target(rect, "pressAuthor", label: row.author ?? "Author")
        }

        var by = y
        if row.showsHeader, let author = row.author {
            by = header(row, author: author, x: bodyX, y: by, width: bodyWidth, pinned: pinned, &b)
        }
        // A body of only emoji is drawn large, as today's `text-2xl` (`isEmojiOnly`).
        let bodyStyle = isEmojiOnly(row.blocks) ? root.at(.display) : root
        by = richText(row.blocks, x: bodyX, y: by, width: bodyWidth, base: bodyStyle, events: true, &b)
        if !row.files.isEmpty {
            by += Token.space("2")
            by = attachments(row.files, x: bodyX, y: by, width: bodyWidth, removable: false, press: "pressAttachment", &b)
        }
        for embed in row.embeds {
            by += Token.space("2")
            by = embedCard(embed, x: bodyX, y: by, width: bodyWidth, event: "pressLink", payload: ["url": .string(embed.url)], &b)
        }
        if !row.reactions.isEmpty {
            by += Token.space("2")
            by = reactions(row.reactions, addable: row.flags.contains(.addable), x: bodyX, y: by, width: bodyWidth, add: "addReaction", &b).maxY
        }
        if let thread = row.thread {
            by += Token.space("2")
            let card = threadCard(thread, x: bodyX, y: by, width: bodyWidth, &b)
            if row.showsHeader { spine(x: x0, top: mainTop, cardMidY: card.midY, &b) }
            by = card.maxY
        }
        if row.flags.contains(.failed) {
            by += Token.space("1")
            by = failure(x: bodyX, y: by, &b)
        }
        let mainBottom = max(by, row.showsHeader ? mainTop + avatarSize : by)
        if pending { b.items.append(.end) }
        let height = ceil(mainBottom + padY)

        // The row's box under everything: highlighted or pinned tint, the pinned edge and shadow.
        let box = CGRect(x: 0, y: top, width: c.width, height: height - top)
        var under: [RowLayout.Item] = []
        let radius = root.style.radius ?? Token.radius("lg")
        if pinned {
            if let shadow = root.style.shadow.flatMap({ Token.shadow($0, dark: c.dark) }) {
                under.append(.shadow(box, radius: radius, shadow: shadow, fill: background(c)))
            }
            let path = UIBezierPath(roundedRect: box, byRoundingCorners: [.topRight, .bottomRight], cornerRadii: CGSize(width: radius, height: radius))
            if let fill = root.fill { under.append(.path(path, color: fill)) }
            under.append(.fill(CGRect(x: 0, y: top, width: edge, height: box.height), radius: 0, color: HazelTheme.Colors.warning.ui(c.dark)))
        } else if let fill = root.fill {
            under.append(.fill(box, radius: radius, color: fill))
        }
        b.items.insert(contentsOf: under, at: boxIndex)
        // The row's own press sits under every inner target.
        b.targets.insert(RowLayout.Target(rect: box, event: "press", payload: [:], label: row.plainText, role: .button), at: 0)
        for emoji in row.quick {
            b.actions.append(.init(label: "React with \(emoji)", event: "pressReaction", payload: ["emoji": .string(emoji)]))
        }
        for action in row.actions {
            let label = actionLabels[action] ?? action
            // As the web: `react` raises `addReaction` when the row handles it, else an `action`.
            b.actions.append(action == "react" && row.flags.contains(.addable)
                ? .init(label: label, event: "addReaction", payload: [:])
                : .init(label: label, event: "action", payload: ["action": .string(action)]))
        }
        return b.finish(height: height, label: row.plainText, entering: row.flags.contains(.entering))
    }

    /// The hover toolbar's labels (`message.ts` `actionLook`), spoken as custom actions.
    static let actionLabels: [String: String] = [
        "react": "Add reaction", "reply": "Reply", "thread": "Reply in thread", "copy": "Copy message",
        "edit": "Edit message", "pin": "Pin message", "unpin": "Unpin message", "issue": "Create issue",
        "delete": "Delete message", "selectText": "Select text",
    ]

    /// A face: today's dither seeded by the name under its one white initial, else initials on the fill.
    static func avatar(_ initials: String, seed: String? = nil, rect: CGRect, style: PartStyle, micro: Bool = false, _ b: inout Builder) {
        let radius = micro ? Token.radius("sm") : style.style.radius ?? Token.radius("xl")
        if let seed, !seed.trimmingCharacters(in: .whitespaces).isEmpty {
            b.items.append(.image(RowDither.image(seed, side: rect.width, radius: radius, scale: b.c.scale), rect))
            let font = RowFont.inter(rect.width * 0.46, weight: HazelTheme.Font.weightSemibold)
            let text = RowText.string(Dither.initial(seed), font, .white, lineHeight: font.lineHeight, wrap: false)
            let size = RowText.measure(text)
            // Centred on the cap height, as the web's `text-box: trim-both cap alphabetic`.
            let top = rect.midY - (font.ascender - font.capHeight / 2)
            b.items.append(.text(text, CGRect(x: rect.midX - size.width / 2, y: top, width: size.width + 1, height: font.lineHeight)))
            return
        }
        b.items.append(.fill(rect, radius: radius, color: style.fill ?? .clear))
        guard !initials.isEmpty else { return }
        let metrics = HazelTheme.text(micro ? HazelTheme.TextStep.micro : style.style.text ?? .caption, b.c.sizeClass)
        let font = RowFont.inter(metrics.size, weight: HazelTheme.Font.weightStrong)
        let text = RowText.string(initials, font, style.ink ?? .secondaryLabel, lineHeight: metrics.lineHeight, wrap: false)
        let size = RowText.measure(text)
        b.items.append(.text(text, CGRect(x: rect.midX - size.width / 2, y: rect.midY - metrics.lineHeight / 2, width: size.width + 1, height: metrics.lineHeight)))
    }

    /// The header line: author, status, provider mark, badges, time, the pinned label. Baselines align
    /// with the author's; it wraps in the compact size class (`@media (width < 48rem)`).
    static func header(_ row: RowData, author: String, x: CGFloat, y: CGFloat, width: CGFloat, pinned: Bool, _ b: inout Builder) -> CGFloat {
        let recipe = HazelTheme.Recipes.message
        let root = PartStyle(recipe, nil, b.c)
        let authorStyle = PartStyle(recipe, "author", b.c)
        let timeStyle = PartStyle(recipe, "time", b.c)
        let gap = PartStyle(recipe, "header", b.c).style.gap ?? Token.space("2")
        let lineHeight = root.lineHeight
        let authorFont = RowFont.inter(root.metrics.size, weight: authorStyle.style.weight ?? RowFont.semibold)
        // Where a font's baseline sits in a line box of `lineHeight` (half-leading above the ascent).
        func baseline(_ font: UIFont, _ height: CGFloat) -> CGFloat { (height - font.lineHeight) / 2 + font.ascender }
        let authorBaseline = baseline(authorFont, lineHeight)

        enum Piece { case text(NSAttributedString, UIFont, CGFloat, String?), box(CGSize, (CGRect, inout Builder) -> Void) }
        var pieces: [Piece] = [.text(RowText.string(author, authorFont, authorStyle.ink ?? .label, lineHeight: lineHeight), authorFont, lineHeight, "pressAuthor")]
        if let status = row.status {
            let label = PartStyle(HazelTheme.Recipes.reactionBar, "reaction", b.c)
            let font = RowFont.inter(label.metrics.size, weight: HazelTheme.Font.weightRegular)
            pieces.append(.text(RowText.string(status, font, root.ink ?? .label, lineHeight: label.metrics.lineHeight), font, label.metrics.lineHeight, nil))
        }
        if let provider = row.provider {
            let size = Token.space("3.5")
            let color = (provider == "discord" ? HazelTheme.Colors.discord : HazelTheme.Colors.slack).ui(b.c.dark)
            pieces.append(.box(CGSize(width: size, height: size)) { rect, b in
                // The provider's mark from the catalog, in its own colours.
                if let image = RowIcon.image(provider, size: size, color: color) { b.items.append(.image(image, rect)) }
            })
        }
        for badge in row.badges {
            let style = PartStyle(HazelTheme.Recipes.badge, nil, b.c, options: ["tone": badge.tone, "size": "small"])
            let text = RowText.string(badge.label, style, wrap: false)
            let s = RowText.measure(text)
            let px = style.style.paddingX ?? 0, py = style.style.paddingY ?? 0
            let size = CGSize(width: s.width + px * 2, height: style.lineHeight + py * 2)
            pieces.append(.box(size) { rect, b in
                b.items.append(.fill(rect, radius: style.style.radius ?? 0, color: style.fill ?? .clear))
                b.items.append(.text(text, CGRect(x: rect.minX + px, y: rect.minY + py, width: s.width + 1, height: style.lineHeight)))
            })
        }
        let timeFont = timeStyle.font()
        pieces.append(.text(RowText.string(row.edited ? "\(row.time) (edited)" : row.time, timeStyle, wrap: false), timeFont, timeStyle.lineHeight, nil))
        if pinned {
            let warning = HazelTheme.Colors.warning.ui(b.c.dark)
            let text = RowText.string("Pinned", timeStyle, color: warning, wrap: false)
            let s = RowText.measure(text)
            let icon = Token.space("3"), iconGap = Token.space("1")
            pieces.append(.box(CGSize(width: icon + iconGap + s.width, height: timeStyle.lineHeight)) { rect, b in
                if let image = RowIcon.image("pin", size: icon, color: warning) {
                    b.items.append(.image(image, CGRect(x: rect.minX, y: rect.midY - icon / 2, width: icon, height: icon)))
                }
                b.items.append(.text(text, CGRect(x: rect.minX + icon + iconGap, y: rect.minY, width: s.width + 1, height: rect.height)))
            })
        }

        var px = x, line = y
        let wraps = b.c.sizeClass == .compact
        for piece in pieces {
            switch piece {
            case let .text(text, font, height, event):
                let s = RowText.measure(text, width: width)
                let w = min(s.width, width)
                if wraps, px > x, px + w > x + width { px = x; line += lineHeight }
                let rect = CGRect(x: px, y: line + authorBaseline - baseline(font, height), width: w + 1, height: max(height, s.height))
                b.items.append(.text(text, rect))
                if let event { b.target(rect, event, label: author) }
                px += w + gap
            case let .box(size, draw):
                if wraps, px > x, px + size.width > x + width { px = x; line += lineHeight }
                draw(CGRect(x: px, y: line + (lineHeight - size.height) / 2, width: size.width, height: size.height), &b)
                px += size.width + gap
            }
        }
        return line + lineHeight
    }

    /// The quoted message above the row: the curve into the avatar, then author and first line.
    static func replyLine(_ reply: RowData.Reply, x: CGFloat, y: CGFloat, _ b: inout Builder) -> CGFloat {
        let label = PartStyle(HazelTheme.Recipes.reactionBar, "reaction", b.c)
        let height = label.lineHeight
        let muted = HazelTheme.Colors.mutedFg.ui(b.c.dark)
        // `replyCurve`: left 21, bottom -3, 22 by 10, a 2px rule left and top with a md corner.
        let curve = CGRect(x: x + 21, y: y + height + 3 - 10, width: 22, height: 10)
        let path = UIBezierPath()
        path.move(to: CGPoint(x: curve.minX + 1, y: curve.maxY))
        path.addLine(to: CGPoint(x: curve.minX + 1, y: curve.minY + Token.radius("md")))
        path.addQuadCurve(to: CGPoint(x: curve.minX + 1 + Token.radius("md"), y: curve.minY + 1), controlPoint: CGPoint(x: curve.minX + 1, y: curve.minY + 1))
        path.addLine(to: CGPoint(x: curve.maxX, y: curve.minY + 1))
        b.items.append(.strokePath(path, color: muted, width: 2))
        var px = x + Token.space("12")
        let gap = Token.space("1.5")
        let face = Token.space("4")
        let avatarStyle = PartStyle(HazelTheme.Recipes.message, "avatarImage", b.c)
        avatar(reply.initials, seed: reply.author, rect: CGRect(x: px, y: y + (height - face) / 2, width: face, height: face), style: avatarStyle, micro: true, &b)
        px += face + gap
        let author = RowText.string(reply.author, label, weight: HazelTheme.Font.weightStrong, color: HazelTheme.Colors.fg.ui(b.c.dark), wrap: false)
        let aw = RowText.measure(author).width
        b.items.append(.text(author, CGRect(x: px, y: y, width: aw + 1, height: height)))
        px += aw + gap
        let quoted = reply.text.isEmpty ? "Click to see attachment" : reply.text
        let text = RowText.string(quoted, label, weight: HazelTheme.Font.weightRegular, color: muted, wrap: false)
        let right = b.c.width - Token.space("0.5")
        b.items.append(.text(text, CGRect(x: px, y: y, width: max(0, right - px), height: height)))
        b.target(CGRect(x: x + Token.space("12"), y: y, width: right - x - Token.space("12"), height: height), "pressReply", label: "Jump to \(reply.author)'s message")
        return y + height
    }

    /// Discord's spine from under the avatar into the thread card's middle (`spine`, renderer-owned).
    static func spine(x: CGFloat, top: CGFloat, cardMidY: CGFloat, _ b: inout Builder) {
        let border = HazelTheme.Colors.border.ui(b.c.dark)
        let left = x + 19 + 1, start = top + Token.space("12"), end = cardMidY, right = x + 19 + 31
        let r = Token.radius("xl")
        guard end - start > r else { return }
        let path = UIBezierPath()
        path.move(to: CGPoint(x: left, y: start))
        path.addLine(to: CGPoint(x: left, y: end - r))
        path.addQuadCurve(to: CGPoint(x: left + r, y: end - 1), controlPoint: CGPoint(x: left, y: end - 1))
        path.addLine(to: CGPoint(x: right, y: end - 1))
        b.items.append(.strokePath(path, color: border, width: 2))
    }

    /// The thread card (`threadPreviewView`): the reply count, then the last reply.
    static func threadCard(_ thread: RowData.Thread, x: CGFloat, y: CGFloat, width: CGFloat, _ b: inout Builder) -> CGRect {
        let style = PartStyle(HazelTheme.Recipes.message, "thread", b.c)
        let rect = CGRect(x: x, y: y, width: min(width, Token.space("8") * 16), height: 58)
        b.items.append(.fill(rect, radius: style.style.radius ?? 0, color: style.fill ?? .clear))
        b.items.append(.stroke(rect, radius: style.style.radius ?? 0, color: style.ring ?? .separator, width: style.style.borderWidth ?? 1))
        let padX = style.style.paddingX ?? Token.space("3")
        let line = style.lineHeight
        let gap = Token.space("1.5")
        let primary = HazelTheme.Colors.primary.ui(b.c.dark)
        let muted = HazelTheme.Colors.mutedFg.ui(b.c.dark)
        let fg = HazelTheme.Colors.fg.ui(b.c.dark)
        let top = rect.minY + (rect.height - line * 2 - Token.space("0.5")) / 2
        var px = rect.minX + padX
        let chevron = Token.space("3.5")
        let count = RowText.string("\(thread.count) \(thread.count == 1 ? "Message" : "Messages")", style, weight: HazelTheme.Font.weightStrong, color: primary, wrap: false)
        let cw = RowText.measure(count).width
        // The thread's name leads (`thread-name`), semibold and truncated; the count and chevron follow.
        if let name = thread.name, !name.isEmpty {
            let title = RowText.string(name, style, weight: RowFont.semibold, color: fg, wrap: false)
            let room = rect.maxX - padX - px - Token.space("2") - cw - Token.space("0.5") - chevron
            let nw = min(RowText.measure(title).width, max(0, room))
            b.items.append(.text(title, CGRect(x: px, y: top, width: nw + 1, height: line)))
            px += nw + Token.space("2")
        }
        b.items.append(.text(count, CGRect(x: px, y: top, width: cw + 1, height: line)))
        px += cw + Token.space("0.5")
        if let image = RowIcon.image("chevron-right", size: chevron, color: primary) {
            b.items.append(.image(image, CGRect(x: px, y: top + (line - chevron) / 2, width: chevron, height: chevron)))
        }
        let second = top + line + Token.space("0.5")
        px = rect.minX + padX
        let face = Token.space("4")
        avatar(thread.initials, seed: thread.author, rect: CGRect(x: px, y: second + (line - face) / 2, width: face, height: face), style: PartStyle(HazelTheme.Recipes.message, "avatarImage", b.c), micro: true, &b)
        px += face + gap
        // Today's `text-fg/85`, as the web's thread author.
        let author = RowText.string(thread.author, style, weight: HazelTheme.Font.weightStrong, color: fg.withAlphaComponent(0.85), wrap: false)
        let aw = RowText.measure(author).width
        b.items.append(.text(author, CGRect(x: px, y: second, width: aw + 1, height: line)))
        px += aw + gap
        let timeStyle = PartStyle(HazelTheme.Recipes.message, "time", b.c)
        let time = RowText.string(thread.time, timeStyle, wrap: false)
        let tw = RowText.measure(time).width
        let previewMax = rect.maxX - padX - px - Token.space("1") - tw
        let preview = RowText.string(thread.preview, style, color: muted, wrap: false)
        let pw = min(RowText.measure(preview).width, max(0, previewMax))
        b.items.append(.text(preview, CGRect(x: px, y: second, width: pw + 1, height: line)))
        px += pw + Token.space("1")
        b.items.append(.text(time, CGRect(x: px, y: second + (line - timeStyle.lineHeight) / 2, width: tw + 1, height: timeStyle.lineHeight)))
        let named = thread.name.map { " \($0)" } ?? ""
        b.target(rect, "pressThread", label: "Open thread\(named), \(thread.count) \(thread.count == 1 ? "message" : "messages")")
        return rect
    }

    static func failure(x: CGFloat, y: CGFloat, _ b: inout Builder) -> CGFloat {
        let style = PartStyle(HazelTheme.Recipes.message, "failure", b.c)
        let ink = style.ink ?? .systemRed
        let line = style.lineHeight
        let gap = style.style.gap ?? Token.space("1.5")
        let icon = Token.space("3.5")
        var px = x
        if let image = RowIcon.image("warning", size: icon, color: ink) {
            b.items.append(.image(image, CGRect(x: px, y: y + (line - icon) / 2, width: icon, height: icon)))
        }
        px += icon + gap
        let text = RowText.string("Not sent.", style, wrap: false)
        let tw = RowText.measure(text).width
        b.items.append(.text(text, CGRect(x: px, y: y, width: tw + 1, height: line)))
        px += tw + gap
        var attrs = RowText.attrs(style.font(weight: HazelTheme.Font.weightStrong), ink, lineHeight: line, wrap: false)
        attrs[.underlineStyle] = NSUnderlineStyle.single.rawValue
        let retry = NSAttributedString(string: "Retry", attributes: attrs)
        let rw = RowText.measure(retry).width
        let rect = CGRect(x: px, y: y, width: rw + 1, height: line)
        b.items.append(.text(retry, rect))
        b.target(rect.insetBy(dx: -4, dy: -4), "retry", label: "Retry")
        return y + line
    }

    // MARK: rich text

    /// One plain paragraph of emoji and spaces only (the web's `isEmojiOnly` in `chat/message.ts`).
    static func isEmojiOnly(_ blocks: [RowData.Block]) -> Bool {
        guard blocks.count == 1, case let .paragraph(runs, nil) = blocks[0],
              runs.allSatisfy({ $0.kind == .plain }) else { return false }
        let text = runs.map(\.text).joined().filter { !$0.isWhitespace }
        return !text.isEmpty && text.allSatisfy { ch in
            ch.unicodeScalars.contains { $0.properties.isEmojiPresentation || ($0.properties.isEmoji && $0.value > 0x238C) }
        }
    }

    /// A row's body blocks: paragraphs and list items, quotes, code blocks. Runs number across the
    /// whole body (the index `pressMention` reports). Returns the bottom.
    static func richText(_ blocks: [RowData.Block], x: CGFloat, y: CGFloat, width: CGFloat, base: PartStyle, events: Bool, _ b: inout Builder) -> CGFloat {
        var y = y
        var margin: CGFloat = 0
        var first = true
        var runIndex = 0
        let ink = base.ink ?? .label
        let muted = HazelTheme.Colors.mutedFg.ui(b.c.dark)
        for block in blocks {
            let blockMargin: CGFloat = switch block {
            case .code: Token.space("2")
            case .quote: Token.space("1")
            case .paragraph: 0
            }
            // Adjacent vertical margins collapse, as CSS's do.
            y += first ? blockMargin : max(margin, blockMargin)
            first = false
            margin = blockMargin
            switch block {
            case let .paragraph(runs, marker):
                var tx = x
                if let marker {
                    tx += Token.space("1")
                    let m = RowText.string(marker, base.font(), muted, lineHeight: base.lineHeight)
                    let mw = RowText.measure(m).width
                    b.items.append(.text(m, CGRect(x: tx, y: y, width: mw + 1, height: base.lineHeight)))
                    tx += mw + Token.space("1.5")
                }
                y = paragraph(runs, x: tx, y: y, width: x + width - tx, base: base, ink: ink, italic: false, runIndex: &runIndex, events: events, &b)
            case let .quote(runs):
                let bar = Token.space("1")
                let tx = x + Token.space("4")
                let bottom = paragraph(runs, x: tx, y: y, width: x + width - tx, base: base, ink: ink, italic: true, runIndex: &runIndex, events: events, &b)
                b.items.append(.fill(CGRect(x: x, y: y, width: bar, height: bottom - y), radius: Token.radius("xs"), color: HazelTheme.Colors.primary.ui(b.c.dark)))
                y = bottom
            case let .code(code, language):
                y = codeBlock(code, language: language, x: x, y: y, width: width, &b)
            }
        }
        return y + margin
    }

    /// One paragraph's runs, wrapped at `width`, with mention and inline-code chips and link targets.
    static func paragraph(_ runs: [RowData.Run], x: CGFloat, y: CGFloat, width: CGFloat, base: PartStyle, ink: UIColor, italic: Bool, runIndex: inout Int, events: Bool, _ b: inout Builder) -> CGFloat {
        let c = b.c
        let line = base.lineHeight
        let size = base.metrics.size
        let primary = HazelTheme.Colors.primary.ui(c.dark)
        let chipPad = Token.space("1")
        let text = NSMutableAttributedString()
        var chips: [(NSRange, UIColor)] = []
        var hits: [(NSRange, String, JSONValue, String, RowLayout.Target.Role)] = []
        for run in runs {
            var font = RowFont.inter(size, weight: HazelTheme.Font.weightRegular, italic: italic)
            var color = ink
            var extra: [NSAttributedString.Key: Any] = [:]
            var chip: UIColor?
            switch run.kind {
            case .plain: break
            case .strong: font = RowFont.inter(size, weight: RowFont.bold, italic: italic)
            case .emphasis: font = RowFont.inter(size, weight: HazelTheme.Font.weightRegular, italic: true)
            case .strike: extra[.strikethroughStyle] = NSUnderlineStyle.single.rawValue
            case .code:
                font = RowFont.mono(HazelTheme.text(HazelTheme.TextStep.code, c.sizeClass).size)
                chip = HazelTheme.Colors.muted.ui(c.dark)
            case .mention:
                font = RowFont.inter(size, weight: HazelTheme.Font.weightStrong, italic: italic)
                color = primary
                chip = HazelTheme.Colors.primaryTint.ui(c.dark)
            case .link:
                color = primary
                extra[.underlineStyle] = NSUnderlineStyle.single.rawValue
            }
            var attrs = RowText.attrs(font, color, lineHeight: line)
            attrs.merge(extra) { _, new in new }
            let start = text.length
            // A chip's horizontal padding: kern before its first glyph (on the previous one) and after its last.
            if chip != nil, start > 0 { text.addAttribute(.kern, value: chipPad, range: NSRange(location: start - 1, length: 1)) }
            text.append(NSAttributedString(string: run.text, attributes: attrs))
            let range = NSRange(location: start, length: text.length - start)
            if let chip, range.length > 0 {
                text.addAttribute(.kern, value: chipPad, range: NSRange(location: text.length - 1, length: 1))
                chips.append((range, chip))
            }
            if run.kind == .mention {
                hits.append((range, "pressMention", ["userId": .string(run.arg ?? ""), "run": .number(Double(runIndex))], run.text, .button))
            } else if run.kind == .link {
                hits.append((range, "pressLink", ["url": .string(run.arg ?? "")], run.text, .link))
            }
            runIndex += 1
        }
        guard text.length > 0 else { return y + line }
        // Ranges need a layout manager; plain text measures with the cheaper bounding rect.
        let (size2, rects) = chips.isEmpty && hits.isEmpty
            ? (RowText.measure(text, width: width), [])
            : RowText.layout(text, width: width, ranges: chips.map(\.0) + hits.map(\.0))
        for (i, chip) in chips.enumerated() {
            for r in rects[i] {
                // The trailing kern is already inside the glyph rect; the leading pad sits before it.
                let box = CGRect(x: x + r.minX - chipPad, y: y + r.minY + 1, width: r.width + chipPad, height: r.height - 2)
                b.items.append(.fill(box, radius: Token.radius("sm"), color: chip.1))
            }
        }
        let rect = CGRect(x: x, y: y, width: width, height: max(size2.height, line))
        b.items.append(.text(text, rect))
        b.selectable.append(.init(text: text, rect: rect))
        if events {
            for (i, hit) in hits.enumerated() {
                for r in rects[chips.count + i] {
                    b.targets.append(.init(rect: r.offsetBy(dx: x, dy: y), event: hit.1, payload: hit.2, label: hit.3, role: hit.4))
                }
            }
        }
        return y + rect.height
    }

    static func codeBlock(_ code: String, language: String, x: CGFloat, y: CGFloat, width: CGFloat, _ b: inout Builder) -> CGFloat {
        let c = b.c
        let metrics = HazelTheme.text(HazelTheme.TextStep.code, c.sizeClass)
        let pad = Token.space("4")
        let tagged = !language.isEmpty && language != "plaintext"
        let right = tagged ? Token.space("14") : pad
        let text = RowText.string(code, RowFont.mono(metrics.size), HazelTheme.Colors.fg.ui(c.dark), lineHeight: metrics.lineHeight)
        let inner = max(20, width - pad - right)
        let s = RowText.measure(text, width: inner)
        let box = CGRect(x: x, y: y, width: width, height: s.height + pad * 2)
        b.items.append(.fill(box, radius: Token.radius("lg"), color: HazelTheme.Colors.muted.ui(c.dark)))
        let rect = CGRect(x: x + pad, y: y + pad, width: inner, height: s.height)
        b.items.append(.text(text, rect))
        b.selectable.append(.init(text: text, rect: rect))
        if tagged {
            let style = PartStyle(HazelTheme.Recipes.badge, nil, c, options: ["tone": "info", "size": "small"], flags: ["pill"])
            let label = RowText.string(language, style, wrap: false)
            let lw = RowText.measure(label).width
            let px = style.style.paddingX ?? 0, py = style.style.paddingY ?? 0
            let tag = CGRect(x: box.maxX - Token.space("2") - lw - px * 2, y: y + Token.space("2"), width: lw + px * 2, height: style.lineHeight + py * 2)
            b.items.append(.fill(tag, radius: style.style.radius ?? 0, color: style.fill ?? .clear))
            b.items.append(.text(label, CGRect(x: tag.minX + px, y: tag.minY + py, width: lw + 1, height: style.lineHeight)))
        }
        return box.maxY
    }

    // MARK: reactions

    /// Wrapping reaction pills (`reactionButton`) and the add pill; the rect they cover.
    @discardableResult
    static func reactions(_ list: [RowData.Reaction], addable: Bool, x: CGFloat, y: CGFloat, width: CGFloat, add: String, _ b: inout Builder) -> CGRect {
        let recipe = HazelTheme.Recipes.reactionBar
        let bar = PartStyle(recipe, nil, b.c)
        let gap = bar.style.gap ?? Token.space("1")
        let rowGap = bar.style.rowGap ?? gap
        var px = x, py = y, right = x, bottom = y
        func place(_ size: CGSize) -> CGRect {
            if px > x, px + size.width > x + width { px = x; py = bottom + rowGap }
            let rect = CGRect(origin: CGPoint(x: px, y: py), size: size)
            px = rect.maxX + gap
            right = max(right, rect.maxX)
            bottom = max(bottom, rect.maxY)
            return rect
        }
        for reaction in list {
            let style = PartStyle(recipe, "reaction", b.c)
            let mine = reaction.mine
            // A pill of mine (`data-mine`): the primary tint, ring and ink, renderer-owned on the web too.
            let ink = mine ? HazelTheme.Colors.primary.ui(b.c.dark) : style.ink ?? .label
            let fill = mine ? HazelTheme.Colors.primaryTint.ui(b.c.dark) : style.fill ?? .clear
            let ring = mine ? HazelTheme.Colors.primaryTintRing.ui(b.c.dark) : style.ring ?? .separator
            let emoji = RowText.string(reaction.emoji, style, color: ink, wrap: false)
            let countAttrs = RowText.attrs(style.font().withMonospacedDigits(), ink, lineHeight: style.lineHeight, wrap: false)
            let count = NSAttributedString(string: "\(reaction.count)", attributes: countAttrs)
            let ew = RowText.measure(emoji).width, cw = RowText.measure(count).width
            let inner = style.style.gap ?? Token.space("1")
            let padX = style.style.paddingX ?? 0, padY = style.style.paddingY ?? 0
            let rect = place(CGSize(width: padX * 2 + ew + inner + cw, height: style.lineHeight + padY * 2))
            b.items.append(.fill(rect, radius: rect.height / 2, color: fill))
            b.items.append(.stroke(rect, radius: rect.height / 2, color: ring, width: 1))
            b.items.append(.text(emoji, CGRect(x: rect.minX + padX, y: rect.minY + padY, width: ew + 1, height: style.lineHeight)))
            b.items.append(.text(count, CGRect(x: rect.minX + padX + ew + inner, y: rect.minY + padY, width: cw + 1, height: style.lineHeight)))
            var target = RowLayout.Target(rect: rect, event: "pressReaction", payload: ["emoji": .string(reaction.emoji)], label: reactionLabel(reaction), role: .button)
            target.selected = mine
            b.targets.append(target)
        }
        if addable {
            let style = PartStyle(recipe, "addReaction", b.c)
            let icon = Token.space("4")
            let padX = style.style.paddingX ?? 0, padY = style.style.paddingY ?? 0
            let rect = place(CGSize(width: padX * 2 + icon, height: style.lineHeight + padY * 2))
            b.items.append(.fill(rect, radius: rect.height / 2, color: style.fill ?? .clear))
            b.items.append(.stroke(rect, radius: rect.height / 2, color: style.ring ?? .separator, width: 1))
            if let image = RowIcon.image("emoji-add", size: icon, color: style.ink ?? .secondaryLabel) {
                b.items.append(.image(image, CGRect(x: rect.midX - icon / 2, y: rect.midY - icon / 2, width: icon, height: icon)))
            }
            b.target(rect, add, label: "Add reaction")
        }
        return CGRect(x: x, y: y, width: right - x, height: bottom - y)
    }

    /// "👍 3 reactions, reacted by Grace, Alan and 1 other" (`reactionPill`'s label).
    static func reactionLabel(_ r: RowData.Reaction) -> String {
        let custom = r.emoji.hasPrefix("http") || r.emoji.hasPrefix("/") || r.emoji.hasPrefix("data:")
        var label = "\(custom ? "custom emoji" : r.emoji) \(r.count) \(r.count == 1 ? "reaction" : "reactions")"
        if !r.names.isEmpty {
            var names = r.names
            if r.others > 0 { names.append("\(r.others) \(r.others == 1 ? "other" : "others")") }
            let last = names.removeLast()
            label += ", reacted by " + (names.isEmpty ? last : names.joined(separator: ", ") + " and " + last)
        }
        return label
    }

    // MARK: attachments

    /// Media in a mosaic, then file cards (`attachmentsView`). Returns the bottom.
    static func attachments(_ list: [RowData.Attachment], x: CGFloat, y: CGFloat, width: CGFloat, removable: Bool, press: String, _ b: inout Builder) -> CGFloat {
        let c = b.c
        let recipe = HazelTheme.Recipes.attachmentGrid
        let root = PartStyle(recipe, nil, c)
        let mosaic = PartStyle(recipe, "mosaic", c)
        let media = PartStyle(recipe, "media", c)
        let column = min(width, Token.space("14") * 8)
        let tile = Token.space("10") * 4
        let gap = mosaic.style.gap ?? Token.space("1")
        let visual = list.filter { $0.kind != .file }
        let files = list.filter { $0.kind == .file }
        var y = y
        if !visual.isEmpty {
            var rects: [CGRect] = []
            if visual.count == 1 {
                let a = visual[0]
                var size = CGSize(width: column / 2, height: tile)
                if let w = a.width, let h = a.height, w > 0, h > 0 {
                    let scale = min(1, 400 / w, 300 / h)
                    size = CGSize(width: (w * scale).rounded(), height: (h * scale).rounded())
                    if size.width > column { size = CGSize(width: column, height: (size.height * column / size.width).rounded()) }
                }
                rects = [CGRect(origin: CGPoint(x: x, y: y), size: size)]
            } else {
                let cell = (column - gap) / 2
                var slots: [(Int, Int, Int)] = []  // column, row, row span
                if visual.count == 3 {
                    slots = [(0, 0, 2), (1, 0, 1), (1, 1, 1)]
                } else {
                    slots = visual.indices.map { ($0 % 2, $0 / 2, 1) }
                }
                for (col, row, span) in slots {
                    rects.append(CGRect(x: x + CGFloat(col) * (cell + gap), y: y + CGFloat(row) * (tile + gap), width: cell, height: tile * CGFloat(span) + gap * CGFloat(span - 1)))
                }
            }
            for (a, rect) in zip(visual, rects) {
                let radius = media.style.radius ?? Token.radius("lg")
                b.items.append(.fill(rect, radius: radius, color: media.fill ?? .clear))
                if a.kind == .video {
                    let title = HazelTheme.text(HazelTheme.TextStep.title, c.sizeClass)
                    let play = RowText.string("▶", RowFont.inter(title.size, weight: HazelTheme.Font.weightRegular), HazelTheme.Colors.primaryFg.ui(c.dark), lineHeight: title.lineHeight, wrap: false)
                    let s = RowText.measure(play)
                    b.items.append(.text(play, CGRect(x: rect.midX - s.width / 2, y: rect.midY - title.lineHeight / 2, width: s.width + 1, height: title.lineHeight)))
                }
                if let p = a.progress { progressBar(p, in: rect, radius: radius, &b) }
                b.targets.append(.init(rect: rect, event: press, payload: ["id": .string(a.id)], label: "Open \(a.name)", role: .image))
                if removable { removeButton(a, in: rect, &b) }
            }
            y = rects.map(\.maxY).max() ?? y
        }
        if !files.isEmpty {
            if !visual.isEmpty { y += root.style.rowGap ?? Token.space("2") }
            let card = PartStyle(recipe, "file", c)
            let name = PartStyle(recipe, "fileName", c)
            let size = PartStyle(recipe, "fileSize", c)
            let filesGap = PartStyle(recipe, "files", c).style.rowGap ?? Token.space("2")
            for (i, a) in files.enumerated() {
                if i > 0 { y += filesGap }
                let pad = card.style.paddingX ?? Token.space("3")
                let icon = Token.space("8")
                let info = name.lineHeight + (a.size == nil ? 0 : size.lineHeight)
                let rect = CGRect(x: x, y: y, width: column, height: max(icon, info) + pad * 2)
                let radius = card.style.radius ?? Token.radius("lg")
                if let shadow = card.style.shadow.flatMap({ Token.shadow($0, dark: c.dark) }) {
                    b.items.append(.shadow(rect, radius: radius, shadow: shadow, fill: card.fill ?? .clear))
                }
                b.items.append(.fill(rect, radius: radius, color: card.fill ?? .clear))
                b.items.append(.stroke(rect, radius: radius, color: card.ring ?? .separator, width: card.style.borderWidth ?? 1))
                let muted = HazelTheme.Colors.mutedFg.ui(c.dark)
                if let image = RowIcon.image("paperclip", size: icon, color: muted) {
                    b.items.append(.image(image, CGRect(x: rect.minX + pad, y: rect.midY - icon / 2, width: icon, height: icon)))
                }
                let tx = rect.minX + pad + icon + (card.style.gap ?? Token.space("3"))
                let tw = rect.maxX - pad - tx
                var ty = rect.midY - info / 2
                b.items.append(.text(RowText.string(a.name, name, wrap: false), CGRect(x: tx, y: ty, width: tw, height: name.lineHeight)))
                ty += name.lineHeight
                if let label = a.size {
                    b.items.append(.text(RowText.string(label, size, wrap: false), CGRect(x: tx, y: ty, width: tw, height: size.lineHeight)))
                }
                if let p = a.progress { progressBar(p, in: rect, radius: radius, &b) }
                b.targets.append(.init(rect: rect, event: press, payload: ["id": .string(a.id)], label: a.size.map { "\(a.name), \($0)" } ?? a.name, role: .button))
                if removable { removeButton(a, in: rect, &b) }
                y = rect.maxY
            }
        }
        return y
    }

    /// Upload progress along a tile's bottom edge, clipped to its corners.
    static func progressBar(_ value: Double, in rect: CGRect, radius: CGFloat, _ b: inout Builder) {
        let h = Token.space("1")
        let track = CGRect(x: rect.minX, y: rect.maxY - h, width: rect.width, height: h)
        let clip = UIBezierPath(roundedRect: rect, cornerRadius: radius)
        let trackPath = UIBezierPath(rect: track)
        b.items.append(.path(intersect(trackPath, clip), color: HazelTheme.Colors.washStrong.ui(b.c.dark)))
        let fill = CGRect(x: track.minX, y: track.minY, width: track.width * CGFloat(min(1, max(0, value))), height: h)
        b.items.append(.path(intersect(UIBezierPath(rect: fill), clip), color: HazelTheme.Colors.primary.ui(b.c.dark)))
    }

    /// `a` clipped to `b`'s area (a bar inside rounded corners), by flattening to their rect intersection
    /// when the bar sits clear of the corners, else the rounded rect's bottom band.
    private static func intersect(_ a: UIBezierPath, _ clip: UIBezierPath) -> UIBezierPath {
        let r = a.bounds.intersection(clip.bounds)
        let radius = min(Token.radius("lg"), r.height)
        return UIBezierPath(roundedRect: r, byRoundingCorners: [.bottomLeft, .bottomRight], cornerRadii: CGSize(width: radius, height: radius))
    }

    static func removeButton(_ a: RowData.Attachment, in rect: CGRect, _ b: inout Builder) {
        let size = Token.space("6")
        let box = CGRect(x: rect.maxX - Token.space("1") - size, y: rect.minY + Token.space("1"), width: size, height: size)
        if let shadow = Token.shadow("xs", dark: b.c.dark) { b.items.append(.shadow(box, radius: size / 2, shadow: shadow, fill: HazelTheme.Colors.bg.ui(b.c.dark))) }
        b.items.append(.fill(box, radius: size / 2, color: HazelTheme.Colors.bg.ui(b.c.dark)))
        let icon = Token.space("3.5")
        if let image = RowIcon.image("close", size: icon, color: HazelTheme.Colors.fg.ui(b.c.dark)) {
            b.items.append(.image(image, CGRect(x: box.midX - icon / 2, y: box.midY - icon / 2, width: icon, height: icon)))
        }
        b.targets.append(.init(rect: box.insetBy(dx: -6, dy: -6), event: "remove", payload: ["id": .string(a.id)], label: "Remove \(a.name)", role: .button))
    }

    // MARK: link cards

    /// A link preview (`linkPreviewView`): title, two lines of description, the site. Returns the bottom.
    static func embedCard(_ embed: RowData.Embed, x: CGFloat, y: CGFloat, width: CGFloat, event: String, payload: JSONValue, _ b: inout Builder) -> CGFloat {
        let c = b.c
        let recipe = HazelTheme.Recipes.embed
        let card = PartStyle(recipe, "card", c)
        let pad = PartStyle(recipe, "cardText", c)
        let title = PartStyle(recipe, "title", c)
        let description = PartStyle(recipe, "description", c)
        let site = PartStyle(recipe, "site", c)
        let w = min(width, Token.space("14") * 8)
        let px = pad.style.paddingX ?? Token.space("3"), py = pad.style.paddingY ?? Token.space("3")
        let inner = w - px * 2
        var ty = y + py
        var parts: [(NSAttributedString, CGRect)] = []
        let siteLabel = embed.siteLabel
        let titleText = RowText.string(embed.title ?? siteLabel, title, weight: RowFont.semibold, color: card.ink, wrap: false)
        parts.append((titleText, CGRect(x: x + px, y: ty, width: inner, height: title.lineHeight)))
        ty += title.lineHeight
        if let text = embed.description {
            ty += Token.space("0.5")
            let d = RowText.string(text, description)
            let h = min(RowText.measure(d, width: inner).height, description.lineHeight * 2)
            parts.append((d, CGRect(x: x + px, y: ty, width: inner, height: h)))
            ty += h
        }
        ty += Token.space("1")
        parts.append((RowText.string(siteLabel, site, wrap: false), CGRect(x: x + px, y: ty, width: inner, height: site.lineHeight)))
        ty += site.lineHeight + py
        let rect = CGRect(x: x, y: y, width: w, height: ty - y)
        let radius = card.style.radius ?? Token.radius("lg")
        b.items.append(.fill(rect, radius: radius, color: card.fill ?? .clear))
        b.items.append(.stroke(rect, radius: radius, color: card.ring ?? .separator, width: card.style.borderWidth ?? 1))
        for (text, r) in parts { b.items.append(.text(text, r)) }
        let label = [embed.title ?? siteLabel, embed.description, siteLabel].compactMap { $0 }.joined(separator: " ")
        b.targets.append(.init(rect: rect, event: event, payload: payload, label: label, role: .link))
        return rect.maxY
    }

    // MARK: dividers

    /// A day divider (label centred between rules) or the unread one (danger rule, label at the end).
    public static func divider(kind: String, label: String, _ c: RowContext) -> RowLayout {
        var b = Builder(c)
        let recipe = HazelTheme.Recipes.listDivider
        let root = PartStyle(recipe, nil, c, options: ["kind": kind])
        let labelStyle = PartStyle(recipe, "label", c, options: ["kind": kind])
        let start = PartStyle(recipe, "lineStart", c, options: ["kind": kind])
        let end = PartStyle(recipe, "lineEnd", c, options: ["kind": kind])
        let padX = root.style.paddingX ?? 0, padY = root.style.paddingY ?? 0
        let gap = root.style.gap ?? 0
        let lpx = labelStyle.style.paddingX ?? 0, lpy = labelStyle.style.paddingY ?? 0
        // Today's date pill is set in the monospace (`font-mono`), as the web renderer does.
        let text = kind == "unread"
            ? RowText.string(label, labelStyle, wrap: false)
            : RowText.string(
                label,
                .monospacedSystemFont(ofSize: labelStyle.metrics.size, weight: .regular),
                labelStyle.ink ?? .secondaryLabel,
                lineHeight: labelStyle.lineHeight,
                wrap: false
            )
        let pill = label.isEmpty ? CGSize.zero : {
            let s = RowText.measure(text)
            return CGSize(width: s.width + lpx * 2, height: labelStyle.lineHeight + lpy * 2)
        }()
        let height = max(pill.height, 1) + padY * 2
        let mid = (height / 2).rounded(.down)
        let unread = kind == "unread"
        let inner = c.width - padX * 2
        let gaps = label.isEmpty ? (unread ? 0 : gap) : (unread ? gap : gap * 2)
        let lines = inner - pill.width - gaps
        let startWidth = unread ? lines : lines / 2
        let one = 1 / c.scale
        b.items.append(.fill(CGRect(x: padX, y: mid, width: startWidth, height: max(one, 1)), radius: 0, color: start.style.divider?.ui(c.dark) ?? .separator))
        var px = padX + startWidth + (label.isEmpty ? 0 : gap)
        if !label.isEmpty {
            let rect = CGRect(x: px, y: (height - pill.height) / 2, width: pill.width, height: pill.height)
            let radius = min(labelStyle.style.radius ?? rect.height / 2, rect.height / 2)
            b.items.append(.fill(rect, radius: radius, color: labelStyle.fill ?? .clear))
            if let ring = labelStyle.ring { b.items.append(.stroke(rect, radius: radius, color: ring, width: 1)) }
            b.items.append(.text(text, CGRect(x: rect.minX + lpx, y: rect.minY + lpy, width: pill.width - lpx * 2 + 1, height: labelStyle.lineHeight)))
            px = rect.maxX + gap
        }
        if !unread {
            b.items.append(.fill(CGRect(x: px, y: mid, width: c.width - padX - px, height: max(one, 1)), radius: 0, color: end.style.divider?.ui(c.dark) ?? .separator))
        }
        return b.finish(height: height, label: label.isEmpty ? (unread ? "New messages" : "Separator") : label)
    }

    // MARK: standalone leaves

    public static func reactionBar(_ list: [RowData.Reaction], addable: Bool, _ c: RowContext) -> RowLayout {
        var b = Builder(c, opaque: false)
        let rect = reactions(list, addable: addable, x: 0, y: 0, width: c.width, add: "add", &b)
        return b.finish(height: rect.height, usedWidth: rect.width, label: "Reactions")
    }

    public static func attachmentGrid(_ list: [RowData.Attachment], removable: Bool, _ c: RowContext) -> RowLayout {
        var b = Builder(c, opaque: false)
        let bottom = attachments(list, x: 0, y: 0, width: c.width, removable: removable, press: "press", &b)
        let used = b.targets.map(\.rect.maxX).max() ?? 0
        return b.finish(height: bottom, usedWidth: min(c.width, used), label: "Attachments")
    }

    public static func embed(_ embed: RowData.Embed, _ c: RowContext) -> RowLayout {
        var b = Builder(c, opaque: false)
        let bottom = embedCard(embed, x: 0, y: 0, width: c.width, event: "press", payload: [:], &b)
        return b.finish(height: bottom, usedWidth: min(c.width, Token.space("14") * 8), label: b.targets.first?.label ?? embed.url)
    }

    /// The list's edge spinner (`loadingStart`, `loadingEnd`): three dots, centred.
    public static func spinner(_ c: RowContext) -> RowLayout {
        var b = Builder(c)
        let part = PartStyle(HazelTheme.Recipes.list, "loadingStart", c)
        let dot = Token.space("1.5"), gap = part.style.gap ?? Token.space("1")
        let padY = part.style.paddingY ?? Token.space("3")
        let total = dot * 3 + gap * 2
        for i in 0..<3 {
            b.items.append(.fill(CGRect(x: (c.width - total) / 2 + CGFloat(i) * (dot + gap), y: padY, width: dot, height: dot), radius: dot / 2, color: HazelTheme.Colors.fg2.ui(c.dark)))
        }
        return b.finish(height: dot + padY * 2, label: "Loading")
    }
}

/// Collects a layout's items, targets and text while laying out.
struct Builder {
    let c: RowContext
    let opaque: Bool
    var items: [RowLayout.Item] = []
    var targets: [RowLayout.Target] = []
    var actions: [RowLayout.Action] = []
    var selectable: [RowLayout.Selectable] = []

    init(_ c: RowContext, opaque: Bool = true) {
        self.c = c
        self.opaque = opaque
    }

    mutating func target(_ rect: CGRect, _ event: String, payload: JSONValue = [:], label: String, role: RowLayout.Target.Role = .button) {
        targets.append(.init(rect: rect, event: event, payload: payload, label: label, role: role))
    }

    func finish(height: CGFloat, usedWidth: CGFloat? = nil, label: String, entering: Bool = false) -> RowLayout {
        RowLayout(
            width: c.width, height: ceil(height), usedWidth: usedWidth.map(ceil), items: items, targets: targets, actions: actions,
            selectable: selectable, label: label, background: opaque ? RowRenderer.background(c) : nil, entering: entering
        )
    }
}

extension UIFont {
    /// The same face with tabular figures (`font-variant-numeric: tabular-nums`).
    func withMonospacedDigits() -> UIFont {
        let descriptor = fontDescriptor.addingAttributes([
            .featureSettings: [[UIFontDescriptor.FeatureKey.type: kNumberSpacingType, UIFontDescriptor.FeatureKey.selector: kMonospacedNumbersSelector]],
        ])
        return UIFont(descriptor: descriptor, size: pointSize)
    }
}


/// The dithered face (`Dither`) as a clipped bitmap, cached by seed, size and corner.
enum RowDither {
    nonisolated(unsafe) private static var cache: [String: UIImage] = [:]
    private static let lock = NSLock()

    static func image(_ seed: String, side: CGFloat, radius: CGFloat, scale: CGFloat) -> UIImage {
        let key = "\(seed)|\(side)|\(radius)|\(scale)"
        lock.lock()
        defer { lock.unlock() }
        if let hit = cache[key] { return hit }
        let hue = Dither.hue(seed), n = Dither.cells(side)
        let dark = UIColor(Dither.oklch(0.4, 0.13, hue)), light = UIColor(Dither.oklch(0.55, 0.12, hue))
        let format = UIGraphicsImageRendererFormat()
        format.scale = scale
        let rect = CGRect(x: 0, y: 0, width: side, height: side)
        let image = UIGraphicsImageRenderer(size: rect.size, format: format).image { context in
            UIBezierPath(roundedRect: rect, cornerRadius: radius).addClip()
            dark.setFill()
            context.fill(rect)
            light.setFill()
            let cell = side / CGFloat(n)
            for y in 0..<n {
                for x in 0..<n where Dither.lit(x, y, n) {
                    context.fill(CGRect(x: CGFloat(x) * cell, y: CGFloat(y) * cell, width: cell, height: cell))
                }
            }
        }
        cache[key] = image
        return image
    }
}
