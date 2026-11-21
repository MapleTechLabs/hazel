import Foundation
import UIKit

/// The screen the app last started on, kept on disk so the next launch draws it at once instead of
/// a blank screen while the page loads, signs in and syncs (the shell's side of the web app's
/// `paint-boot.js`). It is shown only under the same light or dark appearance it was taken in, takes
/// no touches, and goes as soon as the page has settled on its own screen (`WebBridge.receiveScreen`).
struct KeptScreen: Codable, Equatable {
    /// `"light"` or `"dark"`: the screen's looks carry that appearance's colours.
    let appearance: String
    /// The page's `screen` and `tabs` messages, as JSON.
    let screen: Data
    let tabs: Data
    /// The icons the screen and tabs name, as the page's PNG data URLs, by key.
    let icons: [String: String]

    private static let file: URL = {
        let folder = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
        return folder.appendingPathComponent("kept-screen.json")
    }()
    private static let queue = DispatchQueue(label: "sh.hazel.hybrid.kept-screen", qos: .utility)

    static func read() -> KeptScreen? {
        guard let data = try? Data(contentsOf: file) else { return nil }
        return try? JSONDecoder().decode(KeptScreen.self, from: data)
    }

    func write() {
        let kept = self
        Self.queue.async {
            guard let data = try? JSONEncoder().encode(kept) else { return }
            try? data.write(to: Self.file, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
        }
    }

    /// The page started somewhere with no native screen (signed out, say): nothing to show next time.
    static func forget() {
        queue.async { try? FileManager.default.removeItem(at: file) }
    }

    static func appearance(of style: UIUserInterfaceStyle) -> String { style == .dark ? "dark" : "light" }
}
