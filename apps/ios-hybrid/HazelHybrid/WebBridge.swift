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
    /// The page's path (`location.pathname`): where it is.
    private(set) var location = ""
    /// A thread is open over its channel: the shell shows it as a page of its own.
    private(set) var isThreadOpen = false
    /// The screen the page shows, in semantic nodes; `nil` when it has none (not converted).
    private(set) var screen: SemanticNode?
    /// The page has settled once and said what it shows (a native screen, or none): until then the
    /// shell shows neither, so nothing draws half-filled and then jumps.
    private(set) var hasSettled = false
    /// The screen the app last started on (`KeptScreen`), drawn until the page has settled.
    private(set) var kept: Kept?
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
    /// What the next `KeptScreen` is made of: the page's last tabs, and every icon it sent.
    @ObservationIgnored private var tabsData = Data("[]".utf8)
    @ObservationIgnored private var iconURLs: [String: String] = [:]
    /// Where this page load first settled: its screen there is the one kept for the next launch.
    @ObservationIgnored private var startLocation: String?
    /// The page's last screen at its start location, while it is still there.
    @ObservationIgnored private var startScreenData: Data?
    @ObservationIgnored private var keepSoon: DispatchWorkItem?
    @ObservationIgnored private var lastKept: KeptScreen?
    /// What was done on the kept screen, carried out once the page settles (`doWaiting`): a press or
    /// a menu choice on a node, by its place (`SemanticNode.path`), or a tab.
    @ObservationIgnored private var waiting: Waiting?

    private enum Waiting {
        case press(path: [String])
        case choose(path: [String], key: String)
        case tab(String)
    }

    struct Kept {
        let screen: SemanticNode
        let tabs: [WebTab]
        let appearance: String
    }

    override init() {
        super.init()
        guard let kept = KeptScreen.read(),
              let screen = try? JSONDecoder().decode(SemanticNode.self, from: kept.screen)
        else { return }
        self.kept = Kept(
            screen: screen,
            tabs: (try? JSONDecoder().decode([WebTab].self, from: kept.tabs)) ?? [],
            appearance: kept.appearance
        )
        iconURLs = kept.icons
        // Only the few icons the kept screen and its tabs name (`keptNow`): needed for its first frame.
        icons = Self.decodeIcons(kept.icons)
    }

    nonisolated private static func decodeIcons(_ urls: [String: String]) -> [String: UIImage] {
        var decoded: [String: UIImage] = [:]
        for (key, url) in urls {
            guard let comma = url.firstIndex(of: ","),
                  let data = Data(base64Encoded: String(url[url.index(after: comma)...])),
                  let image = UIImage(data: data, scale: 3)?.preparingForDisplay()
            else { continue }
            decoded[key] = image
        }
        return decoded
    }

    /// The page settled on `screenData` (`nil`: no native screen): kept for the next launch when it
    /// is where this page load started, and forgotten when the page started on none (signed out).
    private func keep(_ screenData: Data?) {
        if startLocation == nil {
            startLocation = location
            if screenData == nil {
                keepSoon?.cancel()
                KeptScreen.forget()
                return
            }
        }
        guard location == startLocation else {
            // Gone elsewhere: what comes now is another page's, never mixed into the start screen.
            startScreenData = nil
            return
        }
        startScreenData = screenData
        writeSoon(keptNow())
    }

    /// The start screen as it is now, with the tabs, icons and appearance it shows with; `nil` once
    /// the page has left its start location. Taken whole here, so a write never mixes in later state.
    private func keptNow() -> KeptScreen? {
        guard let screen = startScreenData, location == startLocation else { return nil }
        // Only the icons this screen and its tabs name (keys are content hashes): the file and the
        // launch's decode stay as small as the screen.
        let named = String(decoding: screen + tabsData, as: UTF8.self)
        return KeptScreen(
            appearance: KeptScreen.appearance(of: webView.traitCollection.userInterfaceStyle),
            screen: screen,
            tabs: tabsData,
            icons: iconURLs.filter { named.contains($0.key) }
        )
    }

    private func writeSoon(_ next: KeptScreen?) {
        guard let next else { return }
        keepSoon?.cancel()
        let work = DispatchWorkItem { [weak self] in
            // The page re-reports a screen that did not change: nothing to write.
            guard let self, next != lastKept else { return }
            lastKept = next
            next.write()
        }
        keepSoon = work
        // The screen changes in bursts (a sync's rows): written once they stop.
        DispatchQueue.main.asyncAfter(deadline: .now() + 1, execute: work)
    }

    func selectTab(_ id: String) {
        UISelectionFeedbackGenerator().selectionChanged()
        // A tab of the kept screen's bar: selected once the page has settled (`doWaiting`).
        guard hasSettled else {
            waiting = .tab(id)
            return
        }
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

    func press(_ node: SemanticNode) {
        // A press on the kept screen: its ids are an earlier page's, so it waits for the page's own
        // screen and is carried out on the node in the same place there (`doWaiting`).
        if !hasSettled, let kept {
            waiting = kept.screen.path(to: node.id).map { .press(path: $0) }
            UISelectionFeedbackGenerator().selectionChanged()
            return
        }
        evaluate("__hazelHybrid.press(\(jsString(node.id)))")
    }

    func choose(_ node: SemanticNode, key: String) {
        // A row menu's choice on the kept screen, carried out as a press there is.
        if !hasSettled, let kept {
            waiting = kept.screen.path(to: node.id).map { .choose(path: $0, key: key) }
            return
        }
        evaluate("__hazelHybrid.chooseFromMenu(\(jsString(node.id)), \(jsString(key)))")
    }

    /// The page settled: what was done on the kept screen is done on the page's, on the node in the
    /// same place there, if it has one (the screen it started on is not always the one kept).
    private func doWaiting() {
        guard let waiting else { return }
        self.waiting = nil
        switch waiting {
        case let .press(path):
            guard let node = screen?.node(at: path) else { return }
            evaluate("__hazelHybrid.press(\(jsString(node.id)))")
        case let .choose(path, key):
            guard let node = screen?.node(at: path) else { return }
            evaluate("__hazelHybrid.chooseFromMenu(\(jsString(node.id)), \(jsString(key)))")
        case let .tab(id):
            evaluate("__hazelHybrid.selectTab(\(jsString(id)))")
        }
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
        webView.backgroundColor = .pageBackground
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
        navigation.load = { [weak self, weak webView] url in
            // A new page load (a sign-out, a reload): the kept screen may be a user's who is gone. It
            // goes now, not when the new page settles, so a launch in between never shows it; the new
            // page keeps its own start screen again.
            self?.keepSoon?.cancel()
            self?.startLocation = nil
            self?.startScreenData = nil
            self?.lastKept = nil
            KeptScreen.forget()
            webView.map { Self.loadPage($0, at: url) }
        }
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
        let isLoading = body["loading"] as? Bool ?? false
        let level = body["level"] as? String ?? "log"
        let text = body["text"] as? String ?? ""
        MainActor.assumeIsolated {
            let started = CACurrentMediaTime()
            defer { FrameMonitor.shared.noteBridge(CACurrentMediaTime() - started) }
            switch type {
            case "tabs":
                let decoded = tabsData.flatMap { try? JSONDecoder().decode([WebTab].self, from: $0) } ?? []
                self.tabsData = tabsData ?? Data("[]".utf8)
                writeSoon(keptNow())
                withAnimation(.smooth(duration: 0.25)) { tabs = decoded }
            case "list":
                receiveList(listJSON)
            case "composer":
                let decoded = hasComposer ? composerData.flatMap { try? JSONDecoder().decode(ComposerLook.self, from: $0) } : nil
                if decoded != composer { composer = decoded }
            case "icons":
                // Decoded (base64, PNG) off the main thread; prepared for drawing there too.
                self.iconURLs.merge(iconURLs) { _, new in new }
                writeSoon(keptNow())
                decodeQueue.async { [weak self] in
                    let decoded = Self.decodeIcons(iconURLs)
                    DispatchQueue.main.async {
                        self?.icons.merge(decoded) { _, new in new }
                        self?.iconsArrived?(Set(decoded.keys))
                    }
                }
            case "screen":
                hasSettled = true
                kept = nil
                // Shown still loading (`web/bridge.ts`, `MAX_LOADING_MS`): not where the app starts.
                if !isLoading { keep(screenData) }
                do {
                    screen = try screenData.map { try JSONDecoder().decode(SemanticNode.self, from: $0) }
                } catch {
                    Self.log.error("[shell] screen decode: \(String(describing: error), privacy: .public)")
                }
                doWaiting()
            case "swipeBack":
                canSwipeBack = enabled ?? false
            case "overlay":
                isOverlayOpen = open ?? false
            case "location":
                location = text
            case "thread":
                isThreadOpen = open ?? false
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
