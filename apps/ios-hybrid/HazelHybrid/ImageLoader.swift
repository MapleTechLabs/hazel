import ImageIO
import UIKit

/// The pictures message rows draw (avatars, attachments, embeds), loaded natively: fetched, decoded
/// and downsampled to the size a row draws them at, all off the main thread. A row draws without a
/// picture until it arrives, then draws again (`onLoad`).
@MainActor
final class ImageLoader {
    /// Loaded pictures, by source. Rows read a copy when they draw.
    private(set) var images: [String: UIImage] = [:]
    /// A picture's source arrived: rows that draw it draw again.
    var onLoad: ((String) -> Void)?

    private var loading = Set<String>()
    private var waiters: [String: [CheckedContinuation<UIImage?, Never>]] = [:]
    private var failed = Set<String>()
    /// Oldest first: past `limit`, the oldest picture is dropped (a row needing it loads it again).
    private var order: [String] = []
    private let limit = 300
    private let queue = DispatchQueue(label: "sh.hazel.hybrid.images", qos: .userInitiated, attributes: .concurrent)
    private let webRoot = Bundle.main.resourceURL!.appendingPathComponent("web")

    func want(_ pictures: [(src: String, size: CGSize)], scale: CGFloat) {
        for (src, size) in pictures where images[src] == nil && !loading.contains(src) && !failed.contains(src) {
            loading.insert(src)
            let webRoot = webRoot
            queue.async { [weak self] in
                let image = Self.fetch(src, webRoot: webRoot).flatMap { Self.decode($0, filling: size, scale: scale) }
                DispatchQueue.main.async { self?.loaded(src, image) }
            }
        }
    }

    /// One picture, for a view that shows it by itself (a sidebar avatar): loaded once, then cached.
    func image(_ src: String, size: CGSize, scale: CGFloat) async -> UIImage? {
        if let image = images[src] { return image }
        if failed.contains(src) { return nil }
        return await withCheckedContinuation { continuation in
            waiters[src, default: []].append(continuation)
            want([(src, size)], scale: scale)
        }
    }

    private func loaded(_ src: String, _ image: UIImage?) {
        loading.remove(src)
        for waiter in waiters.removeValue(forKey: src) ?? [] { waiter.resume(returning: image) }
        guard let image else {
            failed.insert(src)
            return
        }
        images[src] = image
        order.append(src)
        if order.count > limit {
            let dropped = order.removeFirst()
            images[dropped] = nil
        }
        onLoad?(src)
    }

    /// The bytes of `src`: from the network, a `data:` URL, or the app's own bundle (`hazel://app/…`).
    nonisolated private static func fetch(_ src: String, webRoot: URL) -> Data? {
        // A path of the app's own (`/images/…`), as the web's data may give it.
        if src.hasPrefix("/") { return try? Data(contentsOf: webRoot.appendingPathComponent(src)) }
        guard var url = URL(string: src) else { return nil }
        if let remote = RemotePicture.original(of: url) { url = remote }
        // The app's own files on the page's origin (`/images/…`) are in the bundle.
        if url.host == HostBridge.pageOrigin.host, url.scheme == HostBridge.pageOrigin.scheme,
           let data = try? Data(contentsOf: webRoot.appendingPathComponent(url.path))
        {
            return data
        }
        switch url.scheme {
        case "hazel":
            return try? Data(contentsOf: webRoot.appendingPathComponent(url.path))
        case "data":
            return try? Data(contentsOf: url)
        default:
            let request = RemotePicture.request(url)
            let semaphore = DispatchSemaphore(value: 0)
            var result: Data?
            URLSession.shared.dataTask(with: request) { data, response, _ in
                if let status = (response as? HTTPURLResponse)?.statusCode, (200..<300).contains(status) { result = data }
                semaphore.signal()
            }.resume()
            semaphore.wait()
            return result
        }
    }

    /// Decoded at no more pixels than it takes to fill `size` (a 4000px photo in a 300pt frame stays
    /// small, its short side still covering the frame), ready to draw.
    nonisolated private static func decode(_ data: Data, filling size: CGSize, scale: CGFloat) -> UIImage? {
        guard let source = CGImageSourceCreateWithData(data as CFData, nil),
              let properties = CGImageSourceCopyPropertiesAtIndex(source, 0, nil) as? [CFString: Any],
              let width = (properties[kCGImagePropertyPixelWidth] as? NSNumber).map({ CGFloat($0.doubleValue) }),
              let height = (properties[kCGImagePropertyPixelHeight] as? NSNumber).map({ CGFloat($0.doubleValue) }),
              width > 0, height > 0
        else { return nil }
        let fill = max(size.width * scale / width, size.height * scale / height)
        let maxPixels = min(max(width, height), max(width, height) * fill)
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceShouldCacheImmediately: true,
            kCGImageSourceThumbnailMaxPixelSize: max(1, Int(maxPixels.rounded(.up))),
        ]
        guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { return nil }
        return UIImage(cgImage: image, scale: scale, orientation: .up)
    }
}
