import UIKit
import WebKit

/// The message list's framed pages (HTML renders, `chat/html-render.ts`): a bot's sandboxed page,
/// from the same signed URL the web's frame loads (its theme in the URL's fragment). A row's bitmap
/// cannot hold another origin's page, so the list lays a live web view over the row where the frame
/// is. The web's own frame, laid out unseen, still sizes it: its height is the row's.
///
/// A few views at once, kept by source, so scrolling back to a render shows it without loading again.
@MainActor
final class FramePool: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
    private struct Shown {
        let view: WKWebView
        var lastUsed: CFTimeInterval
    }

    private static let limit = 8
    private var views: [String: Shown] = [:]
    private let configuration: WKWebViewConfiguration

    override init() {
        let configuration = WKWebViewConfiguration()
        // The bot's page shares nothing with the app (no cookies, no storage).
        configuration.websiteDataStore = .nonPersistent()
        configuration.allowsInlineMediaPlayback = true
        self.configuration = configuration
        super.init()
        // Framed, the page asks its parent to open a link; here it is the top page, so it asks itself.
        let forward = WKUserScript(
            source: """
            addEventListener("message", (event) => {
              const data = event.data
              if (data && data.jsonrpc === "2.0" && data.params && typeof data.params.url === "string")
                window.webkit.messageHandlers.frameLink.postMessage(data.params.url)
            })
            """,
            injectionTime: .atDocumentStart,
            forMainFrameOnly: true
        )
        configuration.userContentController.addUserScript(forward)
        configuration.userContentController.add(WeakHandler(self), name: "frameLink")
    }

    /// The view for `src`, loaded (once) and placed by the caller.
    func view(for src: String) -> WKWebView {
        if var shown = views[src] {
            shown.lastUsed = CACurrentMediaTime()
            views[src] = shown
            return shown.view
        }
        let view = WKWebView(frame: .zero, configuration: configuration)
        view.isOpaque = false
        view.backgroundColor = .clear
        view.scrollView.backgroundColor = .clear
        // Inline, the page never scrolls (its frame is its height): a drag scrolls the list.
        view.scrollView.isScrollEnabled = false
        view.scrollView.contentInsetAdjustmentBehavior = .never
        view.navigationDelegate = self
        view.layer.masksToBounds = true
        if let url = URL(string: src) { view.load(URLRequest(url: url)) }
        views[src] = Shown(view: view, lastUsed: CACurrentMediaTime())
        evict()
        return view
    }

    /// Views no row on screen shows leave the list; the oldest beyond the limit are let go.
    func hideAll(except shown: Set<String>) {
        for (src, entry) in views where !shown.contains(src) { entry.view.isHidden = true }
    }

    private func evict() {
        guard views.count > Self.limit else { return }
        let oldest = views.filter { $0.value.view.isHidden }.sorted { $0.value.lastUsed < $1.value.lastUsed }
        for (src, entry) in oldest.prefix(views.count - Self.limit) {
            entry.view.removeFromSuperview()
            views[src] = nil
        }
    }

    nonisolated func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let link = message.body as? String, let url = URL(string: link), ["http", "https"].contains(url.scheme) else {
            return
        }
        Task { @MainActor in UIApplication.shared.open(url) }
    }

    /// The page itself stays; a link it follows opens in the browser.
    func webView(
        _ webView: WKWebView,
        decidePolicyFor action: WKNavigationAction,
        decisionHandler: @escaping @MainActor @Sendable (WKNavigationActionPolicy) -> Void
    ) {
        if action.navigationType == .linkActivated, let url = action.request.url {
            decisionHandler(.cancel)
            UIApplication.shared.open(url)
            return
        }
        decisionHandler(.allow)
    }
}

/// A script message handler that does not keep its target alive (WebKit retains its handlers).
private final class WeakHandler: NSObject, WKScriptMessageHandler {
    weak var target: (any WKScriptMessageHandler)?
    init(_ target: any WKScriptMessageHandler) { self.target = target }

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        target?.userContentController(controller, didReceive: message)
    }
}
