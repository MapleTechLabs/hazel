import SwiftUI
import UIKit

/// A picture from a `src`: `data:` URLs decode at once (SVG through `SVGView`, others through UIKit),
/// anything else loads with `AsyncImage`. Fills its frame and crops (the web's `object-fit: cover`).
struct Picture: View {
    let src: String

    var body: some View {
        switch Self.decode(src) {
        case let .svg(image):
            SVGView(image: image, fill: true)
        case let .bitmap(image):
            Color.clear.overlay { Image(uiImage: image).resizable().scaledToFill() }.clipped()
        case .remote:
            AsyncImage(url: URL(string: src)) { phase in
                if let image = phase.image { image.resizable().scaledToFill() } else { Color.clear }
            }
            .clipped()
        }
    }

    enum Decoded {
        case svg(SVGImage)
        case bitmap(UIImage)
        case remote
    }

    @MainActor static func decode(_ src: String) -> Decoded {
        guard src.hasPrefix("data:"), let comma = src.firstIndex(of: ",") else { return .remote }
        let header = src[src.index(src.startIndex, offsetBy: 5)..<comma]
        let payload = String(src[src.index(after: comma)...])
        let base64 = header.hasSuffix(";base64")
        let data = base64 ? Data(base64Encoded: payload) : payload.removingPercentEncoding.map { Data($0.utf8) }
        guard let data else { return .remote }
        if header.hasPrefix("image/svg+xml") {
            let markup = String(decoding: data, as: UTF8.self)
            return SVGImage.named(markup).map(Decoded.svg) ?? .remote
        }
        return UIImage(data: data).map(Decoded.bitmap) ?? .remote
    }
}
