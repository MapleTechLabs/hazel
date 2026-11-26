import Foundation
import SwiftUI

// A small SVG reader for the web's icons and `data:image/svg+xml` pictures: `path`, `circle`, `rect`
// and `text` in groups, filled or stroked with `currentColor` (the view's foreground) or a hex colour.

struct SVGImage: Sendable {
    enum Paint: Sendable, Equatable {
        case current
        case color(Double, Double, Double)
    }

    struct Shape: Sendable {
        var path = Path()
        var fill: Paint? = .current
        var stroke: Paint?
        var strokeWidth: CGFloat = 1
        var lineCap: CGLineCap = .butt
        var lineJoin: CGLineJoin = .miter
        var opacity = 1.0, fillOpacity = 1.0, strokeOpacity = 1.0
        var evenOdd = false
        /// A `text` element: its string, anchor point, size and weight.
        var text: (string: String, at: CGPoint, size: CGFloat, bold: Bool)?
    }

    var viewBox = CGRect(x: 0, y: 0, width: 18, height: 18)
    var shapes: [Shape] = []

    @MainActor private static var cache: [String: SVGImage] = [:]

    /// The parsed image for `markup`, parsed once per distinct string.
    @MainActor static func named(_ markup: String) -> SVGImage? {
        if let hit = cache[markup] { return hit }
        guard let image = SVGImage(markup: markup) else { return nil }
        cache[markup] = image
        return image
    }

    init?(markup: String) {
        let reader = Reader()
        let parser = XMLParser(data: Data(markup.utf8))
        parser.delegate = reader
        guard parser.parse(), let box = reader.viewBox else { return nil }
        viewBox = box
        shapes = reader.shapes
    }
}

/// Walks the elements, carrying inherited presentation attributes down through `g`.
private final class Reader: NSObject, XMLParserDelegate {
    var viewBox: CGRect?
    var shapes: [SVGImage.Shape] = []
    private var stack: [SVGImage.Shape] = [SVGImage.Shape()]
    private var textShape: SVGImage.Shape?
    private var textBuffer = ""

    func parser(_ parser: XMLParser, didStartElement name: String, namespaceURI: String?, qualifiedName: String?,
                attributes a: [String: String] = [:]) {
        var shape = inherited(stack.last ?? SVGImage.Shape(), a)
        let n = { (key: String) in CGFloat(Double(a[key] ?? "") ?? 0) }
        switch name {
        case "svg":
            let numbers = PathData.numbers(a["viewBox"] ?? "")
            if numbers.count == 4 {
                viewBox = CGRect(x: numbers[0], y: numbers[1], width: numbers[2], height: numbers[3])
            } else if let w = Double(a["width"] ?? ""), let h = Double(a["height"] ?? "") {
                viewBox = CGRect(x: 0, y: 0, width: w, height: h)
            }
        case "path":
            shape.path = PathData.path(a["d"] ?? "")
            shapes.append(shape)
        case "circle":
            let r = n("r")
            shape.path = Path(ellipseIn: CGRect(x: n("cx") - r, y: n("cy") - r, width: 2 * r, height: 2 * r))
            shapes.append(shape)
        case "rect":
            // A rect without a width or height draws nothing, as in a browser.
            let rect = CGRect(x: n("x"), y: n("y"), width: n("width"), height: n("height"))
            if rect.width > 0, rect.height > 0 {
                let rx = n("rx")
                shape.path = Path(roundedRect: rect, cornerRadius: rx)
                shapes.append(shape)
            }
        case "text":
            let size = a["font-size"].flatMap { Double($0) } ?? 16
            shape.text = ("", CGPoint(x: n("x"), y: n("y")), CGFloat(size), (Int(a["font-weight"] ?? "") ?? 400) >= 600)
            textShape = shape
            textBuffer = ""
        default:
            break
        }
        stack.append(shape)
    }

    func parser(_ parser: XMLParser, foundCharacters string: String) {
        if textShape != nil { textBuffer += string }
    }

    func parser(_ parser: XMLParser, didEndElement name: String, namespaceURI: String?, qualifiedName: String?) {
        if name == "text", var shape = textShape, let text = shape.text {
            shape.text = (textBuffer, text.at, text.size, text.bold)
            shapes.append(shape)
            textShape = nil
        }
        stack.removeLast()
    }

    private func inherited(_ parent: SVGImage.Shape, _ a: [String: String]) -> SVGImage.Shape {
        var s = SVGImage.Shape()
        s.fill = parent.fill
        s.stroke = parent.stroke
        s.strokeWidth = parent.strokeWidth
        s.lineCap = parent.lineCap
        s.lineJoin = parent.lineJoin
        s.fillOpacity = parent.fillOpacity
        s.strokeOpacity = parent.strokeOpacity
        s.evenOdd = parent.evenOdd
        // `opacity` is not inherited: a group's opacity multiplies into its children.
        s.opacity = parent.opacity * (a["opacity"].flatMap { Double($0) } ?? 1)
        if let fill = a["fill"] { s.fill = paint(fill) }
        if let stroke = a["stroke"] { s.stroke = paint(stroke) }
        if let width = a["stroke-width"].flatMap({ Double($0) }) { s.strokeWidth = CGFloat(width) }
        if let value = a["fill-opacity"].flatMap({ Double($0) }) { s.fillOpacity = value }
        if let value = a["stroke-opacity"].flatMap({ Double($0) }) { s.strokeOpacity = value }
        if let rule = a["fill-rule"] { s.evenOdd = rule == "evenodd" }
        switch a["stroke-linecap"] {
        case "round": s.lineCap = .round
        case "square": s.lineCap = .square
        case "butt": s.lineCap = .butt
        default: break
        }
        switch a["stroke-linejoin"] {
        case "round": s.lineJoin = .round
        case "bevel": s.lineJoin = .bevel
        case "miter": s.lineJoin = .miter
        default: break
        }
        return s
    }

    private func paint(_ value: String) -> SVGImage.Paint? {
        if value == "none" { return nil }
        if value == "currentColor" { return .current }
        var hex = value.hasPrefix("#") ? String(value.dropFirst()) : value
        if hex.count == 3 { hex = hex.map { "\($0)\($0)" }.joined() }
        guard hex.count == 6, let v = UInt32(hex, radix: 16) else { return .current }
        return .color(Double((v >> 16) & 0xFF) / 255, Double((v >> 8) & 0xFF) / 255, Double(v & 0xFF) / 255)
    }
}

/// SVG path data (`d`) to a `Path`: every command, absolute and relative; arcs become cubic curves.
enum PathData {
    /// The numbers in a list, as SVG writes them (`.75.75`, `-1-2`, `1e-3`).
    static func numbers(_ text: String) -> [CGFloat] {
        var scanner = Scanner(Array(text.utf8))
        var out: [CGFloat] = []
        while let n = scanner.number() { out.append(n) }
        return out
    }

    static func path(_ d: String) -> Path {
        var s = Scanner(Array(d.utf8))
        var path = Path()
        var current = CGPoint.zero, start = CGPoint.zero
        var lastControl: CGPoint?
        var lastCommand: UInt8 = 0
        while let command = s.command(after: lastCommand) {
            let relative = command >= 97
            let base = relative ? current : .zero
            let upper = relative ? command - 32 : command
            func point() -> CGPoint? {
                guard let x = s.number(), let y = s.number() else { return nil }
                return CGPoint(x: base.x + x, y: base.y + y)
            }
            var reflected: CGPoint {
                guard let c = lastControl else { return current }
                return CGPoint(x: 2 * current.x - c.x, y: 2 * current.y - c.y)
            }
            var control: CGPoint?
            switch upper {
            case UInt8(ascii: "M"):
                guard let p = point() else { return path }
                path.move(to: p)
                current = p
                start = p
            case UInt8(ascii: "L"):
                guard let p = point() else { return path }
                path.addLine(to: p)
                current = p
            case UInt8(ascii: "H"):
                guard let x = s.number() else { return path }
                current = CGPoint(x: base.x + x, y: current.y)
                path.addLine(to: current)
            case UInt8(ascii: "V"):
                guard let y = s.number() else { return path }
                current = CGPoint(x: current.x, y: base.y + y)
                path.addLine(to: current)
            case UInt8(ascii: "C"):
                guard let c1 = point(), let c2 = point(), let p = point() else { return path }
                path.addCurve(to: p, control1: c1, control2: c2)
                control = c2
                current = p
            case UInt8(ascii: "S"):
                let c1 = "CcSs".utf8.contains(lastCommand) ? reflected : current
                guard let c2 = point(), let p = point() else { return path }
                path.addCurve(to: p, control1: c1, control2: c2)
                control = c2
                current = p
            case UInt8(ascii: "Q"):
                guard let c = point(), let p = point() else { return path }
                path.addQuadCurve(to: p, control: c)
                control = c
                current = p
            case UInt8(ascii: "T"):
                let c = "QqTt".utf8.contains(lastCommand) ? reflected : current
                guard let p = point() else { return path }
                path.addQuadCurve(to: p, control: c)
                control = c
                current = p
            case UInt8(ascii: "A"):
                guard let rx = s.number(), let ry = s.number(), let angle = s.number(),
                      let large = s.flag(), let sweep = s.flag(), let p = point() else { return path }
                arc(&path, from: current, to: p, rx: rx, ry: ry, angle: angle, large: large, sweep: sweep)
                current = p
            case UInt8(ascii: "Z"):
                path.closeSubpath()
                current = start
            default:
                return path
            }
            lastControl = control
            // After a moveto, further pairs are linetos.
            lastCommand = upper == UInt8(ascii: "M") ? (relative ? UInt8(ascii: "l") : UInt8(ascii: "L")) : command
        }
        return path
    }

    /// An elliptical arc (SVG endpoint form) as cubic curves (SVG 1.1 appendix F.6).
    private static func arc(_ path: inout Path, from p0: CGPoint, to p1: CGPoint, rx: CGFloat, ry: CGFloat,
                            angle: CGFloat, large: Bool, sweep: Bool) {
        var rx = abs(rx), ry = abs(ry)
        guard rx > 0, ry > 0, p0 != p1 else {
            path.addLine(to: p1)
            return
        }
        let phi = angle * .pi / 180, cosPhi = cos(phi), sinPhi = sin(phi)
        let dx = (p0.x - p1.x) / 2, dy = (p0.y - p1.y) / 2
        let x1 = cosPhi * dx + sinPhi * dy, y1 = -sinPhi * dx + cosPhi * dy
        let lambda = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry)
        if lambda > 1 { rx *= sqrt(lambda); ry *= sqrt(lambda) }
        let num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1
        let den = rx * rx * y1 * y1 + ry * ry * x1 * x1
        var coef = sqrt(max(0, num / den))
        if large == sweep { coef = -coef }
        let cx1 = coef * rx * y1 / ry, cy1 = -coef * ry * x1 / rx
        let cx = cosPhi * cx1 - sinPhi * cy1 + (p0.x + p1.x) / 2
        let cy = sinPhi * cx1 + cosPhi * cy1 + (p0.y + p1.y) / 2
        func angleOf(_ ux: CGFloat, _ uy: CGFloat, _ vx: CGFloat, _ vy: CGFloat) -> CGFloat {
            let a = atan2(ux * vy - uy * vx, ux * vx + uy * vy)
            return a
        }
        let theta1 = angleOf(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry)
        var delta = angleOf((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry)
        if !sweep, delta > 0 { delta -= 2 * .pi } else if sweep, delta < 0 { delta += 2 * .pi }
        let segments = max(1, Int(ceil(abs(delta) / (.pi / 2))))
        let step = delta / CGFloat(segments)
        let k = 4.0 / 3.0 * tan(step / 4)
        func onEllipse(_ t: CGFloat) -> (CGPoint, CGPoint) {
            let cosT = cos(t), sinT = sin(t)
            let p = CGPoint(x: cx + rx * cosT * cosPhi - ry * sinT * sinPhi, y: cy + rx * cosT * sinPhi + ry * sinT * cosPhi)
            let d = CGPoint(x: -rx * sinT * cosPhi - ry * cosT * sinPhi, y: -rx * sinT * sinPhi + ry * cosT * cosPhi)
            return (p, d)
        }
        var t = theta1
        for i in 0..<segments {
            let (a, da) = onEllipse(t)
            let (b, db) = onEllipse(t + step)
            let end = i == segments - 1 ? p1 : b
            path.addCurve(to: end, control1: CGPoint(x: a.x + k * da.x, y: a.y + k * da.y),
                          control2: CGPoint(x: b.x - k * db.x, y: b.y - k * db.y))
            t += step
        }
    }

    /// Reads path data byte by byte.
    struct Scanner {
        let bytes: [UInt8]
        var at = 0

        init(_ bytes: [UInt8]) { self.bytes = bytes }

        private mutating func skipSeparators() {
            while at < bytes.count, bytes[at] == 32 || bytes[at] == 44 || bytes[at] == 9 || bytes[at] == 10 || bytes[at] == 13 {
                at += 1
            }
        }

        /// The next command letter, or the previous command again when a number follows (implicit repeat).
        mutating func command(after last: UInt8) -> UInt8? {
            skipSeparators()
            guard at < bytes.count else { return nil }
            let b = bytes[at]
            if (b >= 65 && b <= 90) || (b >= 97 && b <= 122) {
                at += 1
                return b
            }
            return last == 0 ? nil : last
        }

        /// An arc flag: a single `0` or `1`, which may run into the next number.
        mutating func flag() -> Bool? {
            skipSeparators()
            guard at < bytes.count, bytes[at] == 48 || bytes[at] == 49 else { return nil }
            defer { at += 1 }
            return bytes[at] == 49
        }

        mutating func number() -> CGFloat? {
            skipSeparators()
            let begin = at
            if at < bytes.count, bytes[at] == 45 || bytes[at] == 43 { at += 1 }
            var digits = false, dot = false
            while at < bytes.count {
                let b = bytes[at]
                if b >= 48 && b <= 57 { digits = true; at += 1 }
                else if b == 46, !dot { dot = true; at += 1 }
                else { break }
            }
            if digits, at < bytes.count, bytes[at] == 101 || bytes[at] == 69 {
                var next = at + 1
                if next < bytes.count, bytes[next] == 45 || bytes[next] == 43 { next += 1 }
                if next < bytes.count, bytes[next] >= 48 && bytes[next] <= 57 {
                    at = next
                    while at < bytes.count, bytes[at] >= 48 && bytes[at] <= 57 { at += 1 }
                }
            }
            guard digits, let value = Double(String(decoding: bytes[begin..<at], as: UTF8.self)) else {
                at = begin
                return nil
            }
            return CGFloat(value)
        }
    }
}

/// Draws an `SVGImage` scaled into its frame: `fit` keeps all of it, `fill` covers the frame and clips.
struct SVGView: View {
    let image: SVGImage
    var fill = false

    var body: some View {
        GeometryReader { proxy in
            let box = image.viewBox
            let sx = proxy.size.width / max(box.width, 0.001), sy = proxy.size.height / max(box.height, 0.001)
            let scale = fill ? max(sx, sy) : min(sx, sy)
            let offset = CGPoint(x: (proxy.size.width - box.width * scale) / 2 - box.minX * scale,
                                 y: (proxy.size.height - box.height * scale) / 2 - box.minY * scale)
            let transform = CGAffineTransform(a: scale, b: 0, c: 0, d: scale, tx: offset.x, ty: offset.y)
            ZStack(alignment: .topLeading) {
                ForEach(image.shapes.indices, id: \.self) { index in
                    layer(image.shapes[index], transform, scale)
                }
            }
            .frame(width: proxy.size.width, height: proxy.size.height, alignment: .topLeading)
        }
        .clipped()
    }

    @ViewBuilder private func layer(_ shape: SVGImage.Shape, _ transform: CGAffineTransform, _ scale: CGFloat) -> some View {
        ZStack(alignment: .topLeading) {
            if let text = shape.text, let paint = shape.fill {
                let at = text.at.applying(transform)
                Text(text.string)
                    .font(.system(size: text.size * scale, weight: text.bold ? .bold : .regular))
                    .fixedSize()
                    .foregroundStyle(style(paint))
                    .opacity(shape.fillOpacity)
                    .position(at)
            } else {
                if let paint = shape.fill {
                    shape.path.applying(transform)
                        .fill(style(paint), style: FillStyle(eoFill: shape.evenOdd))
                        .opacity(shape.fillOpacity)
                }
                if let paint = shape.stroke {
                    let stroke = StrokeStyle(lineWidth: shape.strokeWidth, lineCap: shape.lineCap, lineJoin: shape.lineJoin)
                    shape.path.strokedPath(stroke).applying(transform)
                        .fill(style(paint))
                        .opacity(shape.strokeOpacity)
                }
            }
        }
        .opacity(shape.opacity)
    }

    private func style(_ paint: SVGImage.Paint) -> AnyShapeStyle {
        switch paint {
        case .current: AnyShapeStyle(.foreground)
        case let .color(r, g, b): AnyShapeStyle(Color(.sRGB, red: r, green: g, blue: b))
        }
    }
}

/// An icon by `IconName`; an unknown name draws nothing in its box, as on the web.
struct Glyph: View {
    let name: String

    var body: some View {
        if let markup = IconSources.svg[name], let image = SVGImage.named(markup) {
            SVGView(image: image)
        } else {
            Color.clear
        }
    }
}
