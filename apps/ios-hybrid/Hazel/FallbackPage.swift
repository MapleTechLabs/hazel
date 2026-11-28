import HazelUI
import os
import SwiftUI
import WebKit

/// A route with no native screen yet: the bundled web app at its path, pushed like any screen. It
/// signs in through the same keychain record (`HostBridge`), so it opens signed in. Goes away route
/// by route as the shared screens reach the native app (`docs/ios-native.md`).
@MainActor
final class FallbackPage: NSObject, WKScriptMessageHandler, Identifiable {
    nonisolated static let log = Logger(subsystem: "sh.hazel.app", category: "fallback")

    let id = UUID()
    let path: String
    let webView: WKWebView
    private let host = HostBridge()
    private let navigation = PageNavigation()

    init(path: String) {
        self.path = path
        let configuration = WKWebViewConfiguration()
        configuration.setURLSchemeHandler(SchemeHandler(), forURLScheme: SchemeHandler.scheme)
        configuration.userContentController.addScriptMessageHandler(host, contentWorld: .page, name: "host")
        configuration.allowsInlineMediaPlayback = true
        webView = WKWebView(frame: .zero, configuration: configuration)
        super.init()
        // Only the page's console: the hybrid's native islands are not drawn here.
        configuration.userContentController.add(WeakMessages(self), name: "hazel")
        webView.isInspectable = true
        webView.isOpaque = false
        webView.backgroundColor = .systemBackground
        webView.navigationDelegate = navigation
        webView.uiDelegate = navigation
        host.webView = webView
        navigation.load = { [weak webView] url in webView.map { PageNavigation.loadBundledPage($0, at: url) } }
        let url = URL(string: path, relativeTo: HostBridge.pageOrigin)?.absoluteURL ?? HostBridge.pageOrigin
        PageNavigation.loadBundledPage(webView, at: url)
    }

    nonisolated func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any] else { return }
        let type = body["type"] as? String
        let text = body["text"] as? String ?? ""
        MainActor.assumeIsolated {
            switch type {
            case "location": followed(text)
            case "log": Self.log.log("[page] \(text, privacy: .public)")
            default: break
            }
        }
    }

    /// The page went to another of the app's routes (a link in it): the app pushes that route as a
    /// screen of its own, and this page goes back to its own.
    private func followed(_ pathname: String) {
        guard pathname != (URLComponents(string: path)?.path ?? path), pathname.hasPrefix("/") else { return }
        FallbackPages.open(pathname)
        // Under the screen just pushed, this page loads its own route again (the web app's router
        // keeps no history the web view can step back through).
        let own = URL(string: path, relativeTo: HostBridge.pageOrigin)?.absoluteURL ?? HostBridge.pageOrigin
        PageNavigation.loadBundledPage(webView, at: own)
    }
}

/// The `WebFallback` extension (`shared-screens/src/phone/PhoneShell.ts`): one page per path, kept
/// while recent so going back to it shows it as it was.
@MainActor
enum FallbackPages {
    private static var pages: [(path: String, page: FallbackPage)] = []
    private static let kept = 6
    /// Opens one of the app's paths natively (`AppModel.openPath`): a fallback page's own links.
    static var open: (String) -> Void = { _ in }

    static func register() {
        // Its screen's `content` is `fill`: the page has the whole height and scrolls itself.
        HazelExtensions.register("WebFallback", props: WebFallbackProps.self) { props, _ in
            FallbackView(page: page(for: props.path)).frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    static func page(for path: String) -> FallbackPage {
        if let index = pages.firstIndex(where: { $0.path == path }) {
            let entry = pages.remove(at: index)
            pages.append(entry)
            return entry.page
        }
        let page = FallbackPage(path: path)
        pages.append((path, page))
        if pages.count > kept { pages.removeFirst() }
        return page
    }

    static func forget() { pages = [] }
}

struct WebFallbackProps: Decodable {
    let path: String
}

/// The content controller keeps its handlers: through this, the page it serves can still go away.
private final class WeakMessages: NSObject, WKScriptMessageHandler {
    weak var target: (any WKScriptMessageHandler)?

    init(_ target: any WKScriptMessageHandler) { self.target = target }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(controller, didReceive: message)
    }
}

struct FallbackView: UIViewRepresentable {
    let page: FallbackPage

    func makeUIView(context: Context) -> WKWebView { page.webView }
    func updateUIView(_ webView: WKWebView, context: Context) {}
}
