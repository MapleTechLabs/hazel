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
    public let selectable: [Selectable]
    /// What a screen reader reads for the whole row.
    public let label: String
    /// The fill under everything (the list's background), so rows can be opaque bitmaps.
    let background: UIColor?
    /// The row asks to animate in (a message's `entering`).
    public let entering: Bool

    init(
        width: CGFloat, height: CGFloat, usedWidth: CGFloat? = nil, items: [Item], targets: [Target] = [],
        actions: [Action] = [], selectable: [Selectable] = [], label: String = "", background: UIColor? = nil,
        entering: Bool = false
    ) {
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
    }

    /// The front-most target under `point` (row coordinates).
    public func target(at point: CGPoint) -> Target? {
        targets.last { $0.rect.insetBy(dx: -2, dy: -2).contains(point) }
    }
}

extension RowLayout {
    /// Draws into a bitmap at `scale`. Thread-safe (UIKit string drawing off the main thread).
    /// `transparent` leaves out the list's background (a leaf drawn over whatever is behind it).
    public func draw(scale: CGFloat, transparent: Bool = false) -> CGImage? {
        guard height > 0, width > 0 else { return nil }
        let background = transparent ? nil : self.background
        let format = UIGraphicsImageRendererFormat()
        format.scale = scale
        format.opaque = background != nil
        // HAZEL-GAP(row-wide-gamut): 8-bit sRGB, as the list's surfaces are; the wide-gamut tokens would
        // otherwise pick 16-bit extended range, doubling every row's bytes.
        format.preferredRange = .standard
        let renderer = UIGraphicsImageRenderer(size: CGSize(width: width, height: height), format: format)
        return renderer.image { context in paint(context.cgContext, background: background) }.cgImage
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
        surface.lock(options: [], seed: nil)
        defer { surface.unlock(options: [], seed: nil) }
        guard let cg = CGContext(
            data: surface.baseAddress, width: w, height: h, bitsPerComponent: 8, bytesPerRow: surface.bytesPerRow,
            space: CGColorSpace(name: CGColorSpace.sRGB)!,
            bitmapInfo: CGImageAlphaInfo.premultipliedFirst.rawValue | CGBitmapInfo.byteOrder32Little.rawValue
        ) else { return nil }
        cg.translateBy(x: 0, y: CGFloat(h))
        cg.scaleBy(x: scale, y: -scale)
        UIGraphicsPushContext(cg)
        paint(cg, background: background)
        UIGraphicsPopContext()
        return RowSurface(surface: surface, bytes: surface.allocationSize)
    }

    private func paint(_ cg: CGContext, background: UIColor?) {
        if let background {
            background.setFill()
            cg.fill(CGRect(x: 0, y: 0, width: width, height: height))
        }
        for item in items {
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
