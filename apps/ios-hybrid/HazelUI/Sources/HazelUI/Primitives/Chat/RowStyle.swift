import UIKit

/// How a bitmap row is drawn: width, size class, appearance and scale. Rows drawn under one
/// context are interchangeable; a change of any field redraws them.
public struct RowContext: Sendable, Hashable {
    public var width: CGFloat
    public var sizeClass: HazelTheme.SizeClass
    public var dark: Bool
    public var scale: CGFloat

    public init(width: CGFloat, sizeClass: HazelTheme.SizeClass = .compact, dark: Bool = false, scale: CGFloat = 3) {
        self.width = width
        self.sizeClass = sizeClass
        self.dark = dark
        self.scale = scale
    }
}

// The UIKit side of the generated theme for rows drawn off the main thread (CoreText needs UIFont and
// UIColor, not SwiftUI's). Values come only from `HazelTheme`; the SwiftUI side is `Tree/Styling.swift`.

extension HazelTheme.ThemedColor {
    func ui(_ dark: Bool) -> UIColor { (dark ? self.dark : light).uiColor }
}

/// Token lookups by name, as recipes and the web's chat CSS name them.
enum Token {
    static func space(_ step: String) -> CGFloat { HazelTheme.space[step] ?? 0 }
    static func radius(_ name: String) -> CGFloat { min(HazelTheme.radius[name] ?? 0, 1000) }
    static func shadow(_ name: String, dark: Bool) -> HazelTheme.Shadow? {
        HazelTheme.shadows[name].flatMap { (dark ? $0.dark : $0.light).first { !$0.inset } }
    }
}

/// Inter as UIFont (the same faces `Inter.font` names), falling back to the system font when the app
/// has not registered them (the snapshot tests).
enum RowFont {
    // HAZEL-GAP(chat-weights): author, thread and card titles are 600 and `**bold**` 700 on the web;
    // the tokens have regular and strong only, so these two mirror the web renderer's literals.
    static let semibold = 600
    static let bold = 700

    nonisolated(unsafe) private static var cache: [String: UIFont] = [:]
    private static let lock = NSLock()

    static func inter(_ size: CGFloat, weight: Int, italic: Bool = false) -> UIFont {
        let key = "\(size)-\(weight)-\(italic)"
        lock.lock()
        defer { lock.unlock() }
        if let hit = cache[key] { return hit }
        let name = switch weight {
        case ..<450: "Inter-Regular"
        case ..<550: "Inter-Medium"
        case ..<650: "Inter-SemiBold"
        default: "Inter-Bold"
        }
        let system: UIFont.Weight = switch weight {
        case ..<450: .regular
        case ..<550: .medium
        case ..<650: .semibold
        default: .bold
        }
        var font = UIFont(name: name, size: size) ?? UIFont.systemFont(ofSize: size, weight: system)
        if italic, let slanted = font.fontDescriptor.withSymbolicTraits(.traitItalic) {
            font = UIFont(descriptor: slanted, size: size)
        }
        cache[key] = font
        return font
    }

    /// The monospace face for code (`Font.mono` is the web's system stack, so SF Mono here too).
    static func mono(_ size: CGFloat) -> UIFont {
        let key = "mono-\(size)"
        lock.lock()
        defer { lock.unlock() }
        if let hit = cache[key] { return hit }
        let font = UIFont.monospacedSystemFont(ofSize: size, weight: .regular)
        cache[key] = font
        return font
    }

    /// A style's font: its type step, `strong` or the given weight.
    static func of(_ style: HazelTheme.Style, _ sizeClass: HazelTheme.SizeClass, weight: Int? = nil) -> UIFont {
        let metrics = HazelTheme.text(style.text ?? .body, sizeClass)
        let w = weight ?? (style.strong == true ? HazelTheme.Font.weightStrong : HazelTheme.Font.weightRegular)
        return inter(metrics.size, weight: w)
    }
}

/// A recipe part resolved for one row: style, its UIColors under the row's appearance, its font.
struct PartStyle {
    let style: HazelTheme.Style
    let dark: Bool
    let sizeClass: HazelTheme.SizeClass

    init(_ recipe: HazelTheme.Recipe, _ part: String?, _ context: RowContext, options: [String: String] = [:], flags: Set<String> = []) {
        style = recipe.style(part: part, options: options, flags: flags, sizeClass: context.sizeClass)
        dark = context.dark
        sizeClass = context.sizeClass
    }

    var ink: UIColor? { style.color?.ui(dark) }
    var fill: UIColor? { style.background?.ui(dark) }
    var ring: UIColor? { (style.ring ?? style.borderColor)?.ui(dark) }
    var metrics: HazelTheme.TypeMetrics { HazelTheme.text(style.text ?? .body, sizeClass) }
    var lineHeight: CGFloat { style.leading ?? metrics.lineHeight }
    func font(weight: Int? = nil) -> UIFont { RowFont.of(style, sizeClass, weight: weight) }
}

/// Icons inside bitmap rows.
/// HAZEL-GAP(row-icons): lane S1's icon catalog (`scripts/export-icons.ts`) is not in HazelUI yet, so rows
/// draw SF Symbols of the same meaning; swap in the catalog's images when it lands.
enum RowIcon {
    static func symbol(_ name: String) -> String? {
        switch name {
        case "pin": "pin.fill"
        case "chevron-right": "chevron.right"
        case "warning": "exclamationmark.triangle.fill"
        case "paperclip": "paperclip"
        case "emoji-add": "face.smiling"
        case "close": "xmark"
        case "play": "play.fill"
        default: nil
        }
    }

    static func image(_ name: String, size: CGFloat, color: UIColor) -> UIImage? {
        guard let symbol = symbol(name) else { return nil }
        let config = UIImage.SymbolConfiguration(pointSize: size * 0.8, weight: .medium)
        return UIImage(systemName: symbol, withConfiguration: config)?.withTintColor(color, renderingMode: .alwaysOriginal)
    }
}
