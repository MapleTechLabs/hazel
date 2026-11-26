import SwiftUI

// Owned by lane S1 (`docs/hazel-ui.md`, "Phase 2: lanes"). Blocks of runs (`Content.RichText`):
// paragraphs, list items, quotes and code blocks. Runs are numbered in reading order across the
// value, as on the web; a mention reports its number with `pressMention`, a link raises `pressLink`.
struct HzRichText: View {
    let tree: Tree
    let node: Node
    @Environment(\.horizontalSizeClass) private var horizontal
    @Environment(\.hzInRow) private var inRow

    var body: some View {
        let _ = RenderCounter.record(node.id)
        let sizeClass = HazelTheme.SizeClass(horizontal)
        let recipe = HazelTheme.Recipes.richText
        let styles = RichStyles(recipe: recipe, sizeClass: sizeClass)
        let built = RichBuilder.build(node[prop: "blocks"]?.array ?? [], styles)
        let tree = tree, node = node, targets = built.targets
        let key = node[prop: "key"]?.string
        VStack(alignment: .leading, spacing: styles.root.rowGap ?? 0) {
            ForEach(built.blocks.indices, id: \.self) { index in
                block(built.blocks[index], index, key, styles)
            }
        }
        .hzFillWidth(!inRow)
        .tint(styles.link.color?.color)
        .textRenderer(ChipRenderer(
            mention: styles.mention.background?.color ?? .clear, mentionRadius: styles.mention.radius ?? 0,
            code: styles.code.background?.color ?? .clear, codeRadius: styles.code.radius ?? 0, key: key
        ))
        .onDisappear { if let key { RunAnchors.shared.clear(key) } }
        .environment(\.openURL, OpenURLAction { url in
            guard url.scheme == RichBuilder.scheme, let index = Int(url.absoluteString.dropFirst(RichBuilder.scheme.count + 1)),
                  let target = targets[index] else { return .systemAction }
            switch target {
            case let .mention(userId):
                tree.fire(node.id, "pressMention", ["userId": .string(userId), "run": .number(Double(index))])
                return .handled
            case let .link(href):
                // A handled link is the view's to open; an unhandled one opens as a plain link.
                if node.events.contains("pressLink") {
                    tree.fire(node.id, "pressLink", ["url": .string(href)])
                    return .handled
                }
                return URL(string: href).map { .systemAction($0) } ?? .discarded
            }
        })
    }

    @ViewBuilder private func block(_ block: RichBuilder.Block, _ index: Int, _ key: String?, _ styles: RichStyles) -> some View {
        let sizeClass = styles.sizeClass
        switch block {
        case let .text(text):
            text
                .hzAnchorBlock(key, index)
                .hzParagraph(styles.root, sizeClass)
        case let .quote(text):
            text.italic().customAttribute(Oblique())
                .hzAnchorBlock(key, index)
                .hzParagraph(styles.root.merged(styles.quote), sizeClass)
                .padding(.leading, styles.quote.paddingStart ?? 0)
        case let .code(source):
            Text(source)
                .hzParagraph(styles.root.merged(styles.codeBlock), sizeClass)
                .frame(maxWidth: .infinity, alignment: .leading)
                .hzBox(styles.codeBlock)
        }
    }
}

/// The recipe's parts for one size class.
struct RichStyles {
    let sizeClass: HazelTheme.SizeClass
    let root, marker, mention, link, code, strong, codeBlock, quote: HazelTheme.Style

    init(recipe: HazelTheme.Recipe, sizeClass: HazelTheme.SizeClass) {
        self.sizeClass = sizeClass
        let part = { (name: String?) in recipe.style(part: name, sizeClass: sizeClass) }
        root = part(nil)
        marker = part("marker")
        mention = part("mention")
        link = part("link")
        code = part("code")
        strong = part("strong")
        codeBlock = part("codeBlock")
        quote = part("quote")
    }
}

/// Wire blocks to `Text`, numbering runs; mentions and links carry an `hzrun:<n>` link to report.
enum RichBuilder {
    static let scheme = "hzrun"

    enum Block {
        case text(Text)
        case quote(Text)
        case code(String)
    }

    enum Target: Sendable {
        case mention(String)
        case link(String)
    }

    struct Built {
        var blocks: [Block] = []
        var targets: [Int: Target] = [:]
    }

    /// `Content.RunKind` and `Content.BlockKind`.
    private enum RunKind { static let mention = 1.0, link = 2.0, code = 3.0, strong = 4.0, emphasis = 5.0, strike = 6.0 }
    private enum BlockKind { static let paragraph = 0.0, code = 1.0, item = 2.0, quote = 3.0 }

    static func build(_ blocks: [JSONValue], _ styles: RichStyles) -> Built {
        var built = Built()
        var index = 0
        func runs(_ value: JSONValue?) -> Text {
            var out = Text(verbatim: "")
            for run in value?.array ?? [] {
                out = Text("\(out)\(self.run(run, index, styles, &built.targets).customAttribute(RunTag(run: index, block: built.blocks.count)))")
                index += 1
            }
            return out
        }
        for block in blocks {
            guard let parts = block.array, let kind = parts.first?.number else { continue }
            switch kind {
            case BlockKind.paragraph:
                built.blocks.append(.text(runs(parts.item(1))))
            case BlockKind.item:
                let marker = parts.item(2)?.string ?? ""
                let pad = styles.marker.paddingX ?? 0
                let mark = Text("\(gap(pad))\(Text(verbatim: marker).foregroundStyle(styles.marker.color?.color ?? Color.secondary))\(gap(pad))")
                built.blocks.append(.text(Text("\(mark)\(runs(parts.item(1)))")))
            case BlockKind.quote:
                built.blocks.append(.quote(runs(parts.item(1))))
            case BlockKind.code:
                built.blocks.append(.code(parts.item(1)?.string ?? ""))
            default:
                continue
            }
        }
        return built
    }

    /// Horizontal space inside a line (a part's inline padding): an en space, half an em wide, in a
    /// face twice `width` tall, small enough to leave the line box alone.
    private static func gap(_ width: CGFloat) -> Text {
        Text(verbatim: "\u{2002}").font(.system(size: width * 2))
    }

    private static func run(_ value: JSONValue, _ index: Int, _ styles: RichStyles, _ targets: inout [Int: Target]) -> Text {
        if let plain = value.string { return Text(verbatim: plain) }
        guard let parts = value.array, let kind = parts.first?.number else { return Text(verbatim: "") }
        let text = parts.item(1)?.string ?? ""
        let sizeClass = styles.sizeClass
        switch kind {
        case RunKind.mention:
            targets[index] = .mention(parts.item(2)?.string ?? "")
            return chip(linked(text, index), styles.mention, kind: .mention, index, sizeClass, styles.root)
        case RunKind.link:
            targets[index] = .link(parts.item(2)?.string ?? "")
            return linked(text, index)
        case RunKind.code:
            return chip(Text(verbatim: text), styles.code, kind: .code, index, sizeClass, styles.root)
        case RunKind.strong:
            return Text(verbatim: text).font(styles.root.merged(styles.strong).typeFont(sizeClass))
        case RunKind.emphasis:
            return Text(verbatim: text).italic().customAttribute(Oblique())
        case RunKind.strike:
            return Text(verbatim: text).strikethrough()
        default:
            return Text(verbatim: text)
        }
    }

    private static func linked(_ text: String, _ index: Int) -> Text {
        var string = AttributedString(text)
        string.link = URL(string: "\(scheme):\(index)")
        return Text(string)
    }

    /// A run on a rounded fill (`ChipRenderer`), with the part's inline padding on both sides.
    private static func chip(_ text: Text, _ style: HazelTheme.Style, kind: Chip.Kind, _ index: Int,
                             _ sizeClass: HazelTheme.SizeClass, _ root: HazelTheme.Style) -> Text {
        let chip = Chip(kind: kind, run: index)
        let pad = style.paddingX ?? 0
        var body = text.font(root.merged(style).typeFont(sizeClass))
        if let color = style.color { body = body.foregroundStyle(color.color) }
        let lead = gap(pad).customAttribute(chip)
        let trail = gap(pad).customAttribute(chip)
        return Text("\(lead)\(body.customAttribute(chip))\(trail)")
    }
}

/// Marks the glyphs of one mention or inline code run, so the renderer can fill behind them.
struct Chip: TextAttribute {
    enum Kind: Hashable { case mention, code }
    let kind: Kind
    let run: Int
}

/// Italic runs. A face without an italic (Inter as bundled, or the fallback) is slanted by the renderer,
/// as a browser synthesizes oblique type.
struct Oblique: TextAttribute {}

/// Draws each chip's rounded fill behind its glyphs, line by line, then the text (oblique runs slanted).
struct ChipRenderer: TextRenderer {
    let mention: Color
    let mentionRadius: CGFloat
    let code: Color
    let codeRadius: CGFloat
    /// The leaf's key: when set, each run's rect is published (`RunAnchors`).
    var key: String? = nil

    func draw(layout: Text.Layout, in context: inout GraphicsContext) {
        if let key { publish(layout, key) }
        for line in layout {
            var boxes: [Chip: CGRect] = [:]
            var order: [Chip] = []
            for run in line {
                guard let chip = run[Chip.self] else { continue }
                let rect = run.typographicBounds.rect
                if let box = boxes[chip] { boxes[chip] = box.union(rect) } else { boxes[chip] = rect; order.append(chip) }
            }
            for chip in order {
                guard let rect = boxes[chip] else { continue }
                let mention = chip.kind == .mention
                context.fill(
                    RoundedRectangle(cornerRadius: mention ? mentionRadius : codeRadius, style: .continuous).path(in: rect),
                    with: .color(mention ? self.mention : code)
                )
            }
            for run in line {
                guard run[Oblique.self] != nil else {
                    context.draw(run)
                    continue
                }
                // About 11 degrees, pivoting on the baseline so the glyphs stay in place.
                var slanted = context
                let baseline = run.typographicBounds.origin.y
                slanted.translateBy(x: 0, y: baseline)
                slanted.concatenate(CGAffineTransform(a: 1, b: 0, c: -0.2, d: 1, tx: 0, ty: 0))
                slanted.translateBy(x: 0, y: -baseline)
                slanted.draw(run)
            }
        }
    }
}

extension ChipRenderer {
    /// Each tagged run's rect in this text (a run split over lines is the union of its pieces).
    private func publish(_ layout: Text.Layout, _ key: String) {
        var runs: [Int: (block: Int, rect: CGRect)] = [:]
        for line in layout {
            for run in line {
                guard let tag = run[RunTag.self] else { continue }
                let rect = run.typographicBounds.rect
                runs[tag.run] = (tag.block, runs[tag.run].map { $0.rect.union(rect) } ?? rect)
            }
        }
        if !runs.isEmpty { RunAnchors.shared.setRuns(key, runs) }
    }
}

extension View {
    /// Publishes the block's frame on screen for a keyed leaf (`RunAnchors.setBlock`).
    @ViewBuilder fileprivate func hzAnchorBlock(_ key: String?, _ block: Int) -> some View {
        if let key {
            onGeometryChange(for: CGRect.self, of: { $0.frame(in: .global) }) { RunAnchors.shared.setBlock(key, block, $0) }
        } else {
            self
        }
    }
}

extension Array {
    fileprivate func item(_ index: Int) -> Element? { indices.contains(index) ? self[index] : nil }
}
