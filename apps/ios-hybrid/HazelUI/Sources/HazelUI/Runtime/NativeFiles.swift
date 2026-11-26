import Foundation
import ImageIO
import JavaScriptCore
import PhotosUI
import UIKit
import UniformTypeIdentifiers

/// `Files` on iOS (`packages/client-data/src/platform/jsc/ui-services.ts`): the system pickers, the
/// composer's drops and pastes (`holdDropped`), and the presigned PUT straight from disk. A file is
/// copied into a temporary folder of its own and named to JS by a handle; its bytes never enter JS.
public final class NativeFiles: @unchecked Sendable {
    /// A file held for JS, until it is released.
    struct Held: Sendable {
        let handle: String
        let url: URL
        let name: String
        let size: Int
        let type: String
        let width: Int?
        let height: Int?

        var kind: String {
            type.hasPrefix("image/") ? "image" : type.hasPrefix("video/") ? "video" : "file"
        }

        var json: [String: any Sendable] {
            var object: [String: any Sendable] = ["handle": handle, "name": name, "size": size, "type": type, "kind": kind]
            if let width, let height {
                object["width"] = width
                object["height"] = height
            }
            return object
        }
    }

    private let pump: JSCallbackPump
    private let lock = NSLock()
    private var held: [String: Held] = [:]
    private var uploads: [Int: URLSessionUploadTask] = [:]
    private var nextUpload = 1
    private let session = URLSession(configuration: .ephemeral)

    /// Files dropped or pasted on a composer, until JS takes them (`Files.dropped`).
    nonisolated(unsafe) private static var dropped: [Held] = []
    private static let droppedLock = NSLock()

    /// Where pickers present from; the key window's top view controller by default.
    @MainActor public static var presenter: () -> UIViewController? = {
        let root = UIApplication.shared.connectedScenes
            .compactMap { ($0 as? UIWindowScene)?.keyWindow }
            .first?.rootViewController
        var top = root
        while let presented = top?.presentedViewController { top = presented }
        return top
    }

    init(pump: JSCallbackPump) { self.pump = pump }

    static let directory = FileManager.default.temporaryDirectory.appendingPathComponent("hazel-files", isDirectory: true)

    /// The composer's native view holds the files of a drop or paste here, then sends `files`.
    public static func holdDropped(_ urls: [URL]) {
        let files = urls.compactMap { copy($0, name: $0.lastPathComponent) }
        droppedLock.lock()
        dropped = files
        droppedLock.unlock()
    }

    func object(in context: JSContext) -> JSValue {
        let pick: @convention(block) (String, Bool, JSValue) -> Void = { [weak self] accept, multiple, done in
            guard let self else { return }
            self.pick(media: accept == "media", multiple: multiple, done: JSCallback(done, pump: self.pump))
        }
        let takeDropped: @convention(block) () -> [[String: Any]] = { [weak self] in
            guard let self else { return [] }
            Self.droppedLock.lock()
            let files = Self.dropped
            Self.dropped = []
            Self.droppedLock.unlock()
            self.keep(files)
            return files.map(\.json)
        }
        let upload: @convention(block) (String, String, String, JSValue) -> Int = { [weak self] handle, url, type, done in
            guard let self else { return 0 }
            return self.upload(handle, to: url, contentType: type, done: JSCallback(done, pump: self.pump))
        }
        let cancel: @convention(block) (Int) -> Void = { [weak self] id in
            guard let self else { return }
            self.lock.lock()
            let task = self.uploads.removeValue(forKey: id)
            self.lock.unlock()
            task?.cancel()
        }
        let release: @convention(block) (String) -> Void = { [weak self] handle in
            guard let self else { return }
            self.lock.lock()
            let file = self.held.removeValue(forKey: handle)
            self.lock.unlock()
            if let file { try? FileManager.default.removeItem(at: file.url.deletingLastPathComponent()) }
        }
        let object = JSValue(newObjectIn: context)!
        object.setObject(pick, forKeyedSubscript: "pick" as NSString)
        object.setObject(takeDropped, forKeyedSubscript: "takeDropped" as NSString)
        object.setObject(upload, forKeyedSubscript: "upload" as NSString)
        object.setObject(cancel, forKeyedSubscript: "cancel" as NSString)
        object.setObject(release, forKeyedSubscript: "release" as NSString)
        return object
    }

    private func keep(_ files: [Held]) {
        lock.lock()
        for file in files { held[file.handle] = file }
        lock.unlock()
    }

    /// A copy of `source` in a folder of its own, measured; `nil` when it cannot be read.
    static func copy(_ source: URL, name: String) -> Held? {
        let handle = UUID().uuidString.lowercased()
        let folder = directory.appendingPathComponent(handle, isDirectory: true)
        let target = folder.appendingPathComponent(name.isEmpty ? "file" : name)
        let scoped = source.startAccessingSecurityScopedResource()
        defer { if scoped { source.stopAccessingSecurityScopedResource() } }
        do {
            try FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            try FileManager.default.copyItem(at: source, to: target)
        } catch {
            NativePlatform.log.error("[files] could not copy \(name, privacy: .public): \(error, privacy: .public)")
            return nil
        }
        let size = (try? target.resourceValues(forKeys: [.fileSizeKey]).fileSize) ?? 0
        let type = UTType(filenameExtension: target.pathExtension)?.preferredMIMEType ?? ""
        var width: Int?
        var height: Int?
        // The image's size from its header, without decoding it.
        if type.hasPrefix("image/"), let image = CGImageSourceCreateWithURL(target as CFURL, nil),
           let properties = CGImageSourceCopyPropertiesAtIndex(image, 0, nil) as? [CFString: Any]
        {
            width = properties[kCGImagePropertyPixelWidth] as? Int
            height = properties[kCGImagePropertyPixelHeight] as? Int
        }
        return Held(handle: handle, url: target, name: target.lastPathComponent, size: size, type: type, width: width, height: height)
    }

    private func pick(media: Bool, multiple: Bool, done: JSCallback) {
        let finish: @Sendable ([Held]?) -> Void = { [weak self] files in
            guard let files else { return done.call([NSNull(), "denied"]) }
            self?.keep(files)
            done.call([files.map(\.json), NSNull()])
        }
        Task { @MainActor in
            guard let presenter = Self.presenter() else { return finish(nil) }
            let delegate = PickerDelegate(finish: finish)
            if media {
                var configuration = PHPickerConfiguration()
                configuration.filter = .any(of: [.images, .videos])
                configuration.selectionLimit = multiple ? 0 : 1
                let picker = PHPickerViewController(configuration: configuration)
                picker.delegate = delegate
                delegate.retain(picker)
                presenter.present(picker, animated: true)
            } else {
                let picker = UIDocumentPickerViewController(forOpeningContentTypes: [.item], asCopy: true)
                picker.allowsMultipleSelection = multiple
                picker.delegate = delegate
                delegate.retain(picker)
                presenter.present(picker, animated: true)
            }
        }
    }

    private func upload(_ handle: String, to url: String, contentType: String, done: JSCallback) -> Int {
        lock.lock()
        let file = held[handle]
        let id = nextUpload
        nextUpload += 1
        lock.unlock()
        guard let file, let target = URL(string: url) else {
            done.call([0, "No such file or URL"])
            return id
        }
        var request = URLRequest(url: target)
        request.httpMethod = "PUT"
        request.setValue(contentType, forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = 120
        let task = session.uploadTask(with: request, fromFile: file.url) { [weak self] _, response, error in
            self?.lock.lock()
            let wasCancelled = self?.uploads.removeValue(forKey: id) == nil
            self?.lock.unlock()
            if wasCancelled { return }
            let status = (response as? HTTPURLResponse)?.statusCode ?? 0
            done.call([status, error.map { $0.localizedDescription as any Sendable } ?? NSNull()])
        }
        lock.lock()
        uploads[id] = task
        lock.unlock()
        task.resume()
        return id
    }
}

/// The pickers' delegate, kept alive by the picker it serves until it answers once.
@MainActor
private final class PickerDelegate: NSObject, PHPickerViewControllerDelegate, UIDocumentPickerDelegate {
    private let finish: @Sendable ([NativeFiles.Held]?) -> Void
    private var picker: UIViewController?
    private var answered = false

    init(finish: @escaping @Sendable ([NativeFiles.Held]?) -> Void) { self.finish = finish }

    func retain(_ picker: UIViewController) {
        self.picker = picker
        objc_setAssociatedObject(picker, &PickerDelegate.key, self, .OBJC_ASSOCIATION_RETAIN_NONATOMIC)
    }

    private static var key: UInt8 = 0

    private func answer(_ files: [NativeFiles.Held]) {
        guard !answered else { return }
        answered = true
        finish(files)
        picker = nil
    }

    func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
        picker.dismiss(animated: true)
        guard !results.isEmpty else { return answer([]) }
        let group = DispatchGroup()
        let collected = SendableBox(NSMutableArray())
        let lock = NSLock()
        for result in results {
            let provider = result.itemProvider
            guard let type = provider.registeredTypeIdentifiers.first else { continue }
            let suggested = provider.suggestedName
            group.enter()
            provider.loadFileRepresentation(forTypeIdentifier: type) { url, _ in
                // The file is gone when this returns: copy it first.
                if let url, let file = NativeFiles.copy(url, name: suggested.map { name in
                    url.pathExtension.isEmpty ? name : "\(name).\(url.pathExtension)"
                } ?? url.lastPathComponent) {
                    lock.lock()
                    collected.value.add(SendableBox(file))
                    lock.unlock()
                }
                group.leave()
            }
        }
        group.notify(queue: .main) {
            let files = collected.value.compactMap { ($0 as? SendableBox<NativeFiles.Held>)?.value }
            MainActor.assumeIsolated { self.answer(files) }
        }
    }

    func documentPicker(_: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        answer(urls.compactMap { NativeFiles.copy($0, name: $0.lastPathComponent) })
    }

    func documentPickerWasCancelled(_: UIDocumentPickerViewController) {
        answer([])
    }
}
