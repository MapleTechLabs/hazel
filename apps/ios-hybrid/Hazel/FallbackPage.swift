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
        guard let body = message.body as? [String: Any], body["type"] as? String == "console" else { return }
        let text = body["text"] as? String ?? ""
        Self.log.log("[page] \(text, privacy: .public)")
    }
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
