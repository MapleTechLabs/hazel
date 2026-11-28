import SwiftUI
import UIKit

// The shared icon (`swift-icon-view`, `native-icon-image`, `row-icons`): every `IconName` from HazelUI's
// resources (`Resources/Icons`, 96px PNGs from `scripts/export-icons.ts`). Tinted icons are template
// images in the current foreground; a brand mark with its own colours (Slack) is an original image.

enum HazelIcons {
    /// The icons' own grid: an icon with no size from its container draws at 18pt.
    static let naturalSize: CGFloat = 18

    /// Thread-safe: bitmap rows draw icons off the main thread (`RowStyle`).
    nonisolated(unsafe) private static let cache = NSCache<NSString, UIImage>()

    /// The image for `name` at its natural size (template, or original for a mark), nil for a name the
    /// resources lack. Plain PNGs: an asset catalog's packed renditions drew nothing on a device.
    static func uiImage(_ name: String) -> UIImage? {
        guard !name.isEmpty else { return nil }
        if let hit = cache.object(forKey: name as NSString) { return hit }
        let image = load(name, original: false) ?? load(name, original: true)
        if let image { cache.setObject(image, forKey: name as NSString) }
        return image
    }

    private static func load(_ name: String, original: Bool) -> UIImage? {
        let file = original ? "\(name).original" : name
        guard let url = Bundle.module.url(forResource: file, withExtension: "png", subdirectory: "Icons"),
              let cg = UIImage(contentsOfFile: url.path)?.cgImage else { return nil }
        // Its point size is the icons' grid (18pt), so a draw at any size scales down from 96px.
        let image = UIImage(cgImage: cg, scale: CGFloat(cg.width) / naturalSize, orientation: .up)
        return image.withRenderingMode(original ? .alwaysOriginal : .alwaysTemplate)
    }

    static func isTemplate(_ image: UIImage) -> Bool { image.renderingMode != .alwaysOriginal }

    /// `uiImage` drawn at `size` in `color` (a mark keeps its own), for bitmap rows and UIKit hosts.
    static func uiImage(_ name: String, size: CGFloat, color: UIColor) -> UIImage? {
        guard let image = uiImage(name) else { return nil }
        let format = UIGraphicsImageRendererFormat.preferred()
        let drawn = UIGraphicsImageRenderer(size: CGSize(width: size, height: size), format: format).image { _ in
            let tinted = isTemplate(image) ? image.withTintColor(color, renderingMode: .alwaysOriginal) : image
            tinted.draw(in: CGRect(x: 0, y: 0, width: size, height: size))
        }
        return drawn.withRenderingMode(.alwaysOriginal)
    }
}

extension Image {
    /// An icon from the catalog: a template image (tinted by `foregroundStyle`), or a brand mark in its
    /// own colours. Resizable; an unknown name is an empty image.
    init(hazelIcon name: String) {
        if let image = HazelIcons.uiImage(name) {
            let mode: Image.TemplateRenderingMode = HazelIcons.isTemplate(image) ? .template : .original
            self = Image(uiImage: image).renderingMode(mode).resizable()
        } else {
            self = Image(uiImage: UIImage()).resizable()
        }
    }
}

/// One icon in a square: `size` when given, else the size its container sets (`hzIconSize`, a part's
/// recipe `size`), else 18pt. Its ink is the current foreground (set `foregroundStyle` from the recipe).
/// S2, S4 and S5 draw icons through this (or `Image(hazelIcon:)`, `HazelIcons.uiImage(_:size:color:)`).
struct HazelIcon: View {
    let name: String
    var size: CGFloat? = nil
    @Environment(\.hzIconSize) private var containerSize

    var body: some View {
        let side = size ?? containerSize ?? HazelIcons.naturalSize
        Image(hazelIcon: name)
            .interpolation(.high)
            .frame(width: side, height: side)
            .accessibilityHidden(true)
    }
}
