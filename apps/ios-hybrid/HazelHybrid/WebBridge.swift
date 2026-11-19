import OSLog
import SwiftUI
import UIKit
import WebKit

/// A tab of the web app's tab bar island (`web/bridge.ts`).
struct WebTab: Decodable, Identifiable, Equatable {
    let id: String
    let title: String
    let symbol: String?
    let selected: Bool
    let badge: Int?
    /// The tab's own icon, rasterized by the page (`icons`), and its text colour there.
    let image: String?
    let color: String?
}

/// The shell's side of `web/bridge.ts`: the one web view, what the page reports, and what the
/// shell asks of it.
@MainActor
@Observable
final class WebBridge: NSObject, WKScriptMessageHandler {
    static let log = Logger(subsystem: "sh.hazel.hybrid", category: "web")

    /// The page's tabs; empty while the page shows none (inside a conversation).
    private(set) var tabs: [WebTab] = []
    /// The page has somewhere for the left-edge swipe to go.
    private(set) var canSwipeBack = false
    /// A web overlay is open (the command palette, a dialog): the page shows, not the native screen.
    private(set) var isOverlayOpen = false
    /// The screen the page shows, in semantic nodes; `nil` when it has none (not converted).
    private(set) var screen: SemanticNode?
    /// The page has settled once and said what it shows (a native screen, or none): until then the
    /// shell shows neither, so nothing draws half-filled and then jumps.
    private(set) var hasSettled = false
    /// The page's own icons, rasterized by the page (`web/look.ts`), by key.
    private(set) var icons: [String: UIImage] = [:]
    /// Where the page's message list is (its viewport), while it shows one: the native list goes there.
    private(set) var listFrame: CGRect?
    /// The page's composer, while it shows one: the native composer stands in for it.
    private(set) var composer: ComposerLook?
    /// The native list's updates, decoded off the main thread (`NativeListView.apply`).
    /// Hands an update to the native list; `false` when that list is gone (it waits for the next).
    @ObservationIgnored var listSink: ((ListUpdate) -> Bool)? {
        // The list appears a frame after its first update (`listFrame` shows it): it gets what came.
        didSet {
            guard let listSink else { return }
            let waiting = pendingList
            pendingList = []
            for update in waiting where !listSink(update) { pendingList.append(update) }
        }
    }
    /// New icons arrived (rows drawn before them draw again with them).
    @ObservationIgnored var iconsArrived: ((Set<String>) -> Void)?
    /// Updates that came before the native list existed, in order.
    @ObservationIgnored private var pendingList: [ListUpdate] = []
    /// Pictures in rows (`url` items: avatars, attachments, embeds), loaded natively.
    @ObservationIgnored let pictures = ImageLoader()
    var listImages: [String: UIImage] { pictures.images }
    @ObservationIgnored private let decodeQueue = DispatchQueue(label: "sh.hazel.hybrid.decode", qos: .userInteractive)

    @ObservationIgnored private(set) lazy var webView: WKWebView = makeWebView()
    @ObservationIgnored private let host = HostBridge()
    @ObservationIgnored private let navigation = PageNavigation()
    @ObservationIgnored private var pageScroll: NSKeyValueObservation?

    func selectTab(_ id: String) {
        UISelectionFeedbackGenerator().selectionChanged()
        evaluate("__hazelHybrid.selectTab(\(jsString(id)))")
    }

    func swipeBack() { evaluate("__hazelHybrid.swipeBack()") }

    func steerList(to index: Int) { evaluate("__hazelHybrid.listSteer(\(index))") }

    func composerDraft(_ text: String) { evaluate("__hazelHybrid.composerDraft(\(jsString(text)))") }

    func composerSend(_ text: String) { evaluate("__hazelHybrid.composerSend(\(jsString(text)))") }

    func composerAction(_ id: String) { evaluate("__hazelHybrid.composerAction(\(jsString(id)))") }

    func pressListHit(_ id: String) { evaluate("__hazelHybrid.listPress(\(jsString(id)))") }

    func chooseListMenu(_ id: String, key: String) {
        evaluate("__hazelHybrid.listChoose(\(jsString(id)), \(jsString(key)))")
    }

    /// A list update: decoded on a background queue, applied on the main thread.
    private func receiveList(_ json: String?) {
        guard let json else {
            pendingList = []
            listFrame = nil
            return
        }
        decodeQueue.async { [weak self] in
            let update: ListUpdate
            do {
                update = try JSONDecoder().decode(ListUpdate.self, from: Data(json.utf8))
            } catch {
                Self.log.error("[shell] list decode: \(String(describing: error), privacy: .public)")
                return
            }
            DispatchQueue.main.async {
                guard let self else { return }
                let frame = update.frame.cgRect
                if self.listFrame != frame { self.listFrame = frame }
                if self.listSink?(update) != true { self.pendingList.append(update) }
                self.pictures.want(update.rows.flatMap(\.pictures), scale: self.webView.window?.screen.scale ?? 3)
            }
        }
    }

    func press(_ node: SemanticNode) { evaluate("__hazelHybrid.press(\(jsString(node.id)))") }

    func choose(_ node: SemanticNode, key: String) {
        evaluate("__hazelHybrid.chooseFromMenu(\(jsString(node.id)), \(jsString(key)))")
    }

    private func evaluate(_ script: String) {
        webView.evaluateJavaScript(script, completionHandler: nil)
    }

    private func jsString(_ value: String) -> String {
        let data = try! JSONSerialization.data(withJSONObject: [value])
        return String(String(data: data, encoding: .utf8)!.dropFirst().dropLast())
    }

    private func makeWebView() -> WKWebView {
        let configuration = WKWebViewConfiguration()
        configuration.setURLSchemeHandler(SchemeHandler(), forURLScheme: SchemeHandler.scheme)
        configuration.userContentController.add(self, name: "hazel")
        configuration.userContentController.addScriptMessageHandler(host, contentWorld: .page, name: "host")
        configuration.allowsInlineMediaPlayback = true

        let webView = WKWebView(frame: .zero, configuration: configuration)
        webView.isInspectable = true
        webView.isOpaque = false
        webView.backgroundColor = .systemBackground
        // The page is one screen high and keeps clear of the notch, bars and home indicator itself
        // (`env(safe-area-inset-*)`); its lists scroll inside it, so the page itself never does.
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.bounces = false
        webView.scrollView.isScrollEnabled = false
        pageScroll = webView.pinPageScroll()
        webView.hideInputAccessory()
        webView.navigationDelegate = navigation
        webView.uiDelegate = navigation
        host.webView = webView
        navigation.load = { [weak webView] url in webView.map { Self.loadPage($0, at: url) } }
        Self.loadPage(webView, at: HostBridge.pageOrigin)
        return webView
    }

    /// The bundled page at `url` on the web app's origin: its own origin is the web app's, so the
    /// API's CORS and the sign-in flow take it, while every file comes from the bundle (`hazel://`).
    private static func loadPage(_ webView: WKWebView, at url: URL) {
        let index = Bundle.main.resourceURL!.appendingPathComponent("web/index.html")
        guard let html = try? String(contentsOf: index, encoding: .utf8) else { return }
        PageNavigation.isLoadingPage = true
        webView.loadHTMLString(html, baseURL: url)
    }

    nonisolated func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
        let tabsData = (body["tabs"] as? [[String: Any]]).flatMap { try? JSONSerialization.data(withJSONObject: $0) }
        let iconURLs = body["icons"] as? [String: String] ?? [:]
        let listJSON = body["json"] as? String
        let composerData = (body["composer"] as? [String: Any]).flatMap { try? JSONSerialization.data(withJSONObject: $0) }
        let hasComposer = body["composer"] is [String: Any]
        let screenData = (body["screen"] as? [String: Any]).flatMap { try? JSONSerialization.data(withJSONObject: $0) }
        let kind = body["kind"] as? String
        let enabled = body["enabled"] as? Bool
        let open = body["open"] as? Bool
        let level = body["level"] as? String ?? "log"
        let text = body["text"] as? String ?? ""
        MainActor.assumeIsolated {
            let started = CACurrentMediaTime()
            defer { FrameMonitor.shared.noteBridge(CACurrentMediaTime() - started) }
            switch type {
            case "tabs":
                let decoded = tabsData.flatMap { try? JSONDecoder().decode([WebTab].self, from: $0) } ?? []
                withAnimation(.smooth(duration: 0.25)) { tabs = decoded }
            case "list":
                receiveList(listJSON)
            case "composer":
                let decoded = hasComposer ? composerData.flatMap { try? JSONDecoder().decode(ComposerLook.self, from: $0) } : nil
                if decoded != composer { composer = decoded }
            case "icons":
                // Decoded (base64, PNG) off the main thread; prepared for drawing there too.
                decodeQueue.async { [weak self] in
                    var decoded: [String: UIImage] = [:]
                    for (key, url) in iconURLs {
                        guard let comma = url.firstIndex(of: ","),
                              let data = Data(base64Encoded: String(url[url.index(after: comma)...])),
                              let image = UIImage(data: data, scale: 3)?.preparingForDisplay()
                        else { continue }
                        decoded[key] = image
                    }
                    DispatchQueue.main.async {
                        self?.icons.merge(decoded) { _, new in new }
                        self?.iconsArrived?(Set(decoded.keys))
                    }
                }
            case "screen":
                hasSettled = true
                do {
                    screen = try screenData.map { try JSONDecoder().decode(SemanticNode.self, from: $0) }
                } catch {
                    Self.log.error("[shell] screen decode: \(String(describing: error), privacy: .public)")
                }
            case "swipeBack":
                canSwipeBack = enabled ?? false
            case "overlay":
                isOverlayOpen = open ?? false
            case "haptic":
                Self.play(kind ?? "")
            case "log":
                Self.log.log("[web \(level, privacy: .public)] \(text, privacy: .public)")
            default:
                break
            }
        }
    }

    /// `web-foldkit/src/platform/feedback.ts`'s kinds.
    static func play(_ kind: String) {
        switch kind {
        case "selection": UISelectionFeedbackGenerator().selectionChanged()
        case "impact": UIImpactFeedbackGenerator(style: .light).impactOccurred()
        case "success": UINotificationFeedbackGenerator().notificationOccurred(.success)
        case "warning": UINotificationFeedbackGenerator().notificationOccurred(.warning)
        case "error": UINotificationFeedbackGenerator().notificationOccurred(.error)
        default: break
        }
    }
}
