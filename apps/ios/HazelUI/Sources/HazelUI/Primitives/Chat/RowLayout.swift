import CoreVideo
import IOSurface
import UIKit

/// A row laid out for one `RowContext`: its size, what to draw, what can be pressed, and the text a
/// reader can select. Built and drawn off the main thread; immutable once built.
public final class RowLayout: @unchecked Sendable {
    enum Item {
        case text(NSAttributedString, CGRect)
        case fill(CGRect, radius: CGFloat, color: UIColor)
        /// A rounded box with independent corners (the pinned row's square left edge).
        case path(UIBezierPath, color: UIColor)
        case stroke(CGRect, radius: CGFloat, color: UIColor, width: CGFloat)
        case strokePath(UIBezierPath, color: UIColor, width: CGFloat)
        case shadow(CGRect, radius: CGFloat, shadow: HazelTheme.Shadow, fill: UIColor)
        case image(UIImage, CGRect)
        /// A photo filling its box and cropped to it, with rounded corners (`object-fit: cover`).
        case media(UIImage, CGRect, radius: CGFloat)
        /// Everything until the matching `.end` is drawn at this opacity (a pending message's body).
        case begin(alpha: CGFloat)
        case end
    }

    /// Something a press reaches: an event on the row's node, with its payload and spoken label.
    public struct Target: Sendable {
        public enum Role: Sendable { case button, link, image }
        public let rect: CGRect
        public let event: String
        public let payload: JSONValue
        public let label: String
        public let role: Role
        public var selected = false
    }

    /// An accessibility action that has no place on screen (the hover toolbar's entries on the web).
    public struct Action: Sendable {
        public let label: String
        public let event: String
        public let payload: JSONValue
    }

    /// A block of text as drawn, for selection overlays: its string and where it sits.
    public struct Selectable: @unchecked Sendable {
        public let text: NSAttributedString
        public let rect: CGRect
    }

    public let width: CGFloat
    public let height: CGFloat
    /// The width the content takes (a reaction bar's pills), at most `width`.
    public let usedWidth: CGFloat
    let items: [Item]
    public let targets: [Target]
    public let actions: [Action]
    /// Whether the row's actions offer `selectText` (a long press on its text selects it).
    public var offersSelectText: Bool { actions.contains { $0.payload.object?["action"]?.string == "selectText" } }
    public let selectable: [Selectable]
    /// What a screen reader reads for the whole row.
    public let label: String
    /// The fill under everything (the list's background), so rows can be opaque bitmaps.
    let background: UIColor?
    /// The row asks to animate in (a message's `entering`).
    public let entering: Bool
    /// The pieces a reaction motion moves (pill, emoji, count), by the items that draw them.
    public let motionParts: [MotionPart]
    /// Pictures the row drew as placeholders because they were still loading (`RowImages`).
    public let pendingMedia: Set<String>

    /// A piece of the row that moves on its own: a reaction's pill, its emoji or its count.
    public struct MotionPart: Sendable, Equatable {
        public enum Role: Sendable { case reaction, emoji, count }
        /// The reaction's emoji.
        public let key: String
        public let role: Role
        public let rect: CGRect
        public let items: Range<Int>
        public let count: Int
    }

    /// Each reaction's count as drawn, for the next draw to compare with.
    public var reactionCounts: [String: Int] {
        Dictionary(motionParts.filter { $0.role == .count }.map { ($0.key, $0.count) }, uniquingKeysWith: { a, _ in a })
    }

    init(
        width: CGFloat, height: CGFloat, usedWidth: CGFloat? = nil, items: [Item], targets: [Target] = [],
        actions: [Action] = [], selectable: [Selectable] = [], label: String = "", background: UIColor? = nil,
        entering: Bool = false, motionParts: [MotionPart] = [], pendingMedia: Set<String> = []
    ) {
        self.pendingMedia = pendingMedia
        self.width = width
        self.height = height
        self.usedWidth = usedWidth ?? width
        self.items = items
        self.targets = targets
        self.actions = actions
        self.selectable = selectable
        self.label = label
        self.background = background
        self.entering = entering
        self.motionParts = motionParts
    }

    /// The front-most target under `point` (row coordinates).
    public func target(at point: CGPoint) -> Target? {
        targets.last { $0.rect.insetBy(dx: -2, dy: -2).contains(point) }
    }
}

extension RowLayout {
    /// Draws into a bitmap at `scale`. Thread-safe (UIKit string drawing off the main thread).
    /// `transparent` leaves out the list's background (a leaf drawn over whatever is behind it).
    /// `skipping`: items left out (the pieces a motion draws on their own).
    public func draw(scale: CGFloat, transparent: Bool = false, skipping: IndexSet = []) -> CGImage? {
        guard height > 0, width > 0 else { return nil }
        let background = transparent ? nil : self.background
        let w = Int(ceil(width * scale)), h = Int(ceil(height * scale))
        guard let cg = Self.context(width: w, height: h, data: nil, bytesPerRow: 0, opaque: background != nil)
        else { return nil }
        cg.translateBy(x: 0, y: CGFloat(h))
        cg.scaleBy(x: scale, y: -scale)
        UIGraphicsPushContext(cg)
        paint(cg, background: background, skipping: skipping)
        UIGraphicsPopContext()
        return cg.makeImage()
    }

    /// One motion part alone on a transparent bitmap of its pixel-aligned rect (`pixelRect`), so it
    /// lies over the base drawn `skipping` it exactly where the whole row draws it.
    public func drawPart(_ part: MotionPart, scale: CGFloat) -> CGImage? {
        let rect = Self.pixelRect(part.rect, scale: scale)
        let w = Int((rect.width * scale).rounded()), h = Int((rect.height * scale).rounded())
        guard w > 0, h > 0, let cg = Self.context(width: w, height: h, data: nil, bytesPerRow: 0, opaque: false)
        else { return nil }
        cg.translateBy(x: 0, y: CGFloat(h))
        cg.scaleBy(x: scale, y: -scale)
        cg.translateBy(x: -rect.minX, y: -rect.minY)
        UIGraphicsPushContext(cg)
        paint(cg, background: nil, only: part.items)
        UIGraphicsPopContext()
        return cg.makeImage()
    }

    /// `rect` grown to whole device pixels, with a pixel to spare for antialiasing and the stroke.
    public static func pixelRect(_ rect: CGRect, scale: CGFloat) -> CGRect {
        let grown = rect.insetBy(dx: -1, dy: -1)
        let x0 = floor(grown.minX * scale) / scale, y0 = floor(grown.minY * scale) / scale
        let x1 = ceil(grown.maxX * scale) / scale, y1 = ceil(grown.maxY * scale) / scale
        return CGRect(x: x0, y: y0, width: x1 - x0, height: y1 - y0)
    }

    /// Row surfaces are 8-bit Display P3 (`row-wide-gamut`): the wide-gamut tokens keep their colour
    /// without the 16-bit extended range, which would double every row's bytes.
    static let colorSpace = CGColorSpace(name: CGColorSpace.displayP3)!

    static func context(width: Int, height: Int, data: UnsafeMutableRawPointer?, bytesPerRow: Int, opaque: Bool) -> CGContext? {
        let alpha = opaque ? CGImageAlphaInfo.noneSkipFirst : CGImageAlphaInfo.premultipliedFirst
        return CGContext(
            data: data, width: width, height: height, bitsPerComponent: 8, bytesPerRow: bytesPerRow,
            space: colorSpace, bitmapInfo: alpha.rawValue | CGBitmapInfo.byteOrder32Little.rawValue
        )
    }

    /// Draws into an IOSurface a layer shows as is: setting it as `contents` copies nothing on the main
    /// thread, where a CGImage is copied at commit. For the list's rows, drawn off the main thread.
    public func surface(scale: CGFloat) -> RowSurface? {
        guard height > 0, width > 0 else { return nil }
        let w = Int(ceil(width * scale)), h = Int(ceil(height * scale))
        let properties: [IOSurfacePropertyKey: Any] = [
            .width: w, .height: h, .bytesPerElement: 4, .pixelFormat: kCVPixelFormatType_32BGRA,
        ]
        guard let surface = IOSurface(properties: properties) else { return nil }
        // Tagged, so Core Animation reads the pixels as Display P3.
        if let space = Self.colorSpace.copyPropertyList() { surface.setAttachment(space, forKey: "IOSurfaceColorSpace") }
        surface.lock(options: [], seed: nil)
        defer { surface.unlock(options: [], seed: nil) }
        guard let cg = Self.context(width: w, height: h, data: surface.baseAddress, bytesPerRow: surface.bytesPerRow, opaque: false)
        else { return nil }
        cg.translateBy(x: 0, y: CGFloat(h))
        cg.scaleBy(x: scale, y: -scale)
        UIGraphicsPushContext(cg)
        paint(cg, background: background, skipping: [])
        UIGraphicsPopContext()
        return RowSurface(surface: surface, bytes: surface.allocationSize)
    }

    private func paint(_ cg: CGContext, background: UIColor?, skipping: IndexSet = [], only: Range<Int>? = nil) {
        if let background {
            background.setFill()
            cg.fill(CGRect(x: 0, y: 0, width: width, height: height))
        }
        for (index, item) in items.enumerated() {
            if skipping.contains(index) { continue }
            if let only, !only.contains(index) { continue }
            switch item {
            case let .text(text, rect):
                text.draw(with: rect, options: [.usesLineFragmentOrigin, .truncatesLastVisibleLine], context: nil)
            case let .fill(rect, radius, color):
                color.setFill()
                UIBezierPath(roundedRect: rect, cornerRadius: min(radius, rect.height / 2, rect.width / 2)).fill()
            case let .path(path, color):
                color.setFill()
                path.fill()
            case let .stroke(rect, radius, color, width):
                color.setStroke()
                let inset = rect.insetBy(dx: width / 2, dy: width / 2)
                let path = UIBezierPath(roundedRect: inset, cornerRadius: max(0, min(radius, inset.height / 2, inset.width / 2)))
                path.lineWidth = width
                path.stroke()
            case let .strokePath(path, color, width):
                color.setStroke()
                path.lineWidth = width
                path.stroke()
            case let .shadow(rect, radius, shadow, fill):
                cg.saveGState()
                cg.setShadow(offset: CGSize(width: shadow.x, height: shadow.y), blur: shadow.blur, color: shadow.color.uiColor.cgColor)
                fill.setFill()
                UIBezierPath(roundedRect: rect, cornerRadius: min(radius, rect.height / 2)).fill()
                cg.restoreGState()
            case let .image(image, rect):
                image.draw(in: rect)
            case let .media(image, rect, radius):
                cg.saveGState()
                UIBezierPath(roundedRect: rect, cornerRadius: min(radius, rect.height / 2, rect.width / 2)).addClip()
                let scale = max(rect.width / max(image.size.width, 1), rect.height / max(image.size.height, 1))
                let size = CGSize(width: image.size.width * scale, height: image.size.height * scale)
                image.draw(in: CGRect(x: rect.midX - size.width / 2, y: rect.midY - size.height / 2, width: size.width, height: size.height))
                cg.restoreGState()
            case let .begin(alpha):
                cg.saveGState()
                cg.setAlpha(alpha)
                cg.beginTransparencyLayer(auxiliaryInfo: nil)
            case .end:
                cg.endTransparencyLayer()
                cg.restoreGState()
            }
        }
    }
}

/// A row's pixels for a layer's `contents`, and what they cost.
public struct RowSurface: @unchecked Sendable {
    public let surface: IOSurface
    public let bytes: Int
}
