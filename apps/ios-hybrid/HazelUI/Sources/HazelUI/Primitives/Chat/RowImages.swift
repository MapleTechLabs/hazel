import ImageIO
import UIKit

/// Remote pictures for drawn rows and the lightbox. A picture downloads once (its bytes are kept), then
/// decodes off the main thread at the size it is drawn at, never the original's (a 4000px photo in a
/// 200pt tile decodes at 512px). A row drawn before its picture arrived shows the placeholder and lists
/// the url (`RowLayout.pendingMedia`); `loaded` names the url when it arrives, and the list draws it again.
public final class RowImages: @unchecked Sendable {
    public static let shared = RowImages()
    /// Posted on the main queue with the url (`object`) once a picture is decoded.
    public static let loaded = Notification.Name("sh.hazel.ui.rowImageLoaded")

    private let lock = NSLock()
    private let decoded = NSCache<NSString, UIImage>()
    private let bytes = NSCache<NSString, NSData>()
    /// Decodes in flight, by cache key; downloads in flight, by url, with what waits on them.
    private var decoding: Set<String> = []
    private var downloading: [String: [@Sendable (Data?) -> Void]] = [:]
    private let session: URLSession
    private let queue = DispatchQueue(label: "sh.hazel.ui.images", qos: .userInitiated, attributes: .concurrent)

    init() {
        decoded.totalCostLimit = 96 * 1024 * 1024
        bytes.totalCostLimit = 64 * 1024 * 1024
        let configuration = URLSessionConfiguration.default
        configuration.urlCache = URLCache(memoryCapacity: 0, diskCapacity: 256 * 1024 * 1024)
        configuration.requestCachePolicy = .returnCacheDataElseLoad
        session = URLSession(configuration: configuration)
    }

    /// Sizes snap to powers of two, so near sizes share one decode.
    static func bucket(_ pixels: Int) -> Int {
        var size = 256
        while size < pixels && size < 4096 { size *= 2 }
        return size
    }

    private static func key(_ url: String, _ bucket: Int) -> String { "\(bucket)|\(url)" }

    /// The picture at `url` decoded for `pixels` (its longest side), from the cache; nil starts the load.
    public func image(_ url: String, pixels: Int) -> UIImage? {
        let bucket = Self.bucket(pixels)
        let key = Self.key(url, bucket)
        if let hit = decoded.object(forKey: key as NSString) { return hit }
        load(url, bucket: bucket) { _ in }
        return nil
    }

    /// The largest picture already decoded for `url`, whatever its size (what the lightbox shows first).
    public func best(_ url: String) -> UIImage? {
        for bucket in [4096, 2048, 1024, 512, 256] {
            if let hit = decoded.object(forKey: Self.key(url, bucket) as NSString) { return hit }
        }
        return nil
    }

    /// The smallest picture decoded for `url` (a tile's), to stand in for a page out of view.
    public func small(_ url: String) -> UIImage? {
        for bucket in [256, 512, 1024] {
            if let hit = decoded.object(forKey: Self.key(url, bucket) as NSString) { return hit }
        }
        return nil
    }

    /// Loads `url` decoded for `pixels`, then calls `done` on the main queue (nil when it failed).
    public func load(_ url: String, pixels: Int, _ done: @escaping @MainActor @Sendable (UIImage?) -> Void) {
        load(url, bucket: Self.bucket(pixels)) { image in DispatchQueue.main.async { done(image) } }
    }

    private func load(_ url: String, bucket: Int, _ done: @escaping @Sendable (UIImage?) -> Void) {
        let key = Self.key(url, bucket)
        if let hit = decoded.object(forKey: key as NSString) { return done(hit) }
        lock.lock()
        let fresh = decoding.insert(key).inserted
        lock.unlock()
        // Another caller's decode will post `loaded`; only the first one decodes.
        guard fresh else { return done(nil) }
        fetch(url) { [weak self] data in
            guard let self else { return }
            self.queue.async {
                let image = data.flatMap { Self.decode($0, maxPixels: bucket) }
                if let image {
                    let cost = Int(image.size.width * image.size.height * image.scale * image.scale * 4)
                    self.decoded.setObject(image, forKey: key as NSString, cost: cost)
                }
                self.lock.lock()
                self.decoding.remove(key)
                self.lock.unlock()
                done(image)
                if image != nil {
                    DispatchQueue.main.async { NotificationCenter.default.post(name: Self.loaded, object: url) }
                }
            }
        }
    }

    private func fetch(_ url: String, _ done: @escaping @Sendable (Data?) -> Void) {
        if let kept = bytes.object(forKey: url as NSString) { return done(kept as Data) }
        guard let remote = URL(string: url) else { return done(nil) }
        lock.lock()
        let first = downloading[url] == nil
        downloading[url, default: []].append(done)
        lock.unlock()
        guard first else { return }
        session.dataTask(with: remote) { [weak self] data, response, _ in
            guard let self else { return }
            let ok = (response as? HTTPURLResponse).map { (200..<300).contains($0.statusCode) } ?? (data != nil)
            let body = ok ? data : nil
            if let body { self.bytes.setObject(body as NSData, forKey: url as NSString, cost: body.count) }
            self.lock.lock()
            let waiting = self.downloading.removeValue(forKey: url) ?? []
            self.lock.unlock()
            for wait in waiting { wait(body) }
        }.resume()
    }

    /// A thumbnail of at most `maxPixels` on its longest side, decoded now (not on first draw).
    static func decode(_ data: Data, maxPixels: Int) -> UIImage? {
        guard let source = CGImageSourceCreateWithData(data as CFData, [kCGImageSourceShouldCache: false] as CFDictionary)
        else { return nil }
        let options: [CFString: Any] = [
            kCGImageSourceCreateThumbnailFromImageAlways: true,
            kCGImageSourceCreateThumbnailWithTransform: true,
            kCGImageSourceShouldCacheImmediately: true,
            kCGImageSourceThumbnailMaxPixelSize: maxPixels,
        ]
        guard let image = CGImageSourceCreateThumbnailAtIndex(source, 0, options as CFDictionary) else { return nil }
        return UIImage(cgImage: image)
    }
}

/// Where a row's media tile is on screen, for the lightbox to open from and close into. The lists
/// that draw tiles register here; the lightbox asks them by attachment id.
@MainActor
public enum MediaFrames {
    private static let lists = NSHashTable<MessageListView>.weakObjects()

    static func register(_ list: MessageListView) { lists.add(list) }

    /// The tile showing attachment `id` in window coordinates, when one is on screen.
    public static func frame(of id: String) -> CGRect? {
        for list in lists.allObjects {
            if let frame = list.windowFrame(ofMedia: id) { return frame }
        }
        return nil
    }
}
