import AuthenticationServices
import Security
import UIKit
import WebKit

/// What the page asks of the shell for signing in (`web/host.ts`, the desktop sign-in's host APIs):
/// the keychain vault that keeps the session, the auth API's requests (made here: its native mode
/// refuses a browser's), and the system sign-in sheet, whose callback goes back to the page.
@MainActor
final class HostBridge: NSObject, WKScriptMessageHandlerWithReply {
    /// The app the hosted sign-in page hands back to (`nativeClient.returnUrl`).
    static let callbackScheme = "com.hazel.native"
    /// The web app: its sign-in pages open in the sign-in sheet, the rest in the page itself.
    nonisolated static let appOrigin = URL(string: "https://app.hazel.sh")!
    /// The origin the page runs on: the web app's, or for an offline build (`OFFLINE=1 build.sh`)
    /// an http one, so the fixture's local HTML renders frame in it as real ones do.
    nonisolated static let pageOrigin: URL = (Bundle.main.object(forInfoDictionaryKey: "HazelPageOrigin") as? String)
        .flatMap { $0.isEmpty ? nil : URL(string: $0) } ?? appOrigin

    weak var webView: WKWebView?
    private var signIn: ASWebAuthenticationSession?
    private let presentation = SheetAnchor()
    /// The auth API's requests: no cookies, no cache, no redirects followed.
    private lazy var session: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpCookieStorage = nil
        configuration.httpShouldSetCookies = false
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.timeoutIntervalForRequest = 30
        return URLSession(configuration: configuration, delegate: NoRedirects(), delegateQueue: nil)
    }()

    nonisolated func userContentController(
        _ controller: WKUserContentController,
        didReceive message: WKScriptMessage,
        replyHandler: @escaping @MainActor @Sendable (Any?, String?) -> Void
    ) {
        guard let body = message.body as? [String: Any], let command = body["command"] as? String else {
            Task { @MainActor in replyHandler(["error": "bad request"], nil) }
            return
        }
        let args = body["args"] as? [String: Any] ?? [:]
        let record = args["record"] as? String
        let url = args["url"] as? String
        let request = args["request"] as? [String: Any]
        let method = request?["method"] as? String ?? "GET"
        let requestURL = request?["url"] as? String
        let headers = request?["headers"] as? [[String]] ?? []
        let requestBody = request?["body"] as? String
        Task { @MainActor in
            switch command {
            case "auth_vault_read":
                replyHandler(["value": Vault.read() as Any], nil)
            case "auth_vault_write":
                guard let record else { return replyHandler(["error": "no record"], nil) }
                replyHandler(Vault.write(record) ? ["value": NSNull()] : ["error": "storage"], nil)
            case "auth_http":
                guard let requestURL, let target = URL(string: requestURL) else {
                    return replyHandler(["error": "bad url"], nil)
                }
                var outgoing = URLRequest(url: target)
                outgoing.httpMethod = method
                for pair in headers where pair.count == 2 { outgoing.setValue(pair[1], forHTTPHeaderField: pair[0]) }
                outgoing.httpBody = requestBody.map { Data($0.utf8) }
                do {
                    let (data, response) = try await session.data(for: outgoing)
                    let http = response as? HTTPURLResponse
                    let fields = (http?.allHeaderFields ?? [:]).compactMap { key, value -> [String]? in
                        guard let key = key as? String else { return nil }
                        return [key, "\(value)"]
                    }
                    replyHandler([
                        "value": [
                            "status": http?.statusCode ?? 0,
                            "headers": fields,
                            "body": String(decoding: data, as: UTF8.self),
                        ],
                    ], nil)
                } catch {
                    replyHandler(["error": error.localizedDescription], nil)
                }
            case "open_url":
                guard let url, let target = URL(string: url) else { return replyHandler(["error": "bad url"], nil) }
                open(target)
                replyHandler(["value": NSNull()], nil)
            default:
                replyHandler(["error": "unknown command \(command)"], nil)
            }
        }
    }

    /// The web app's sign-in page in the system's sign-in sheet (the browser's own session, so a
    /// signed-in browser needs no new sign-in); anything else in the browser.
    func open(_ url: URL) {
        guard url.host == Self.appOrigin.host, url.path.hasPrefix("/auth") else {
            UIApplication.shared.open(url)
            return
        }
        signIn?.cancel()
        let session = ASWebAuthenticationSession(url: url, callback: .customScheme(Self.callbackScheme)) {
            [weak self] callback, _ in
            // A cancelled sheet hands nothing back; the page's sign-in times out or is started again.
            guard let callback else { return }
            Task { @MainActor in self?.deliver(callback) }
        }
        session.presentationContextProvider = presentation
        signIn = session
        session.start()
    }

    private func deliver(_ callback: URL) {
        let data = try! JSONSerialization.data(withJSONObject: [callback.absoluteString])
        let argument = String(String(decoding: data, as: UTF8.self).dropFirst().dropLast())
        webView?.evaluateJavaScript("window.__hazelOpenUrl?.(\(argument))", completionHandler: nil)
    }
}

/// The sign-in sheet's window: the app's key window.
private final class SheetAnchor: NSObject, ASWebAuthenticationPresentationContextProviding {
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        MainActor.assumeIsolated {
            UIApplication.shared.connectedScenes
                .compactMap { ($0 as? UIWindowScene)?.keyWindow }
                .first ?? ASPresentationAnchor()
        }
    }
}

/// A redirect is answered as it is, never followed (as a browser fetch with `redirect: "error"`).
private final class NoRedirects: NSObject, URLSessionTaskDelegate {
    func urlSession(
        _ session: URLSession,
        task: URLSessionTask,
        willPerformHTTPRedirection response: HTTPURLResponse,
        newRequest request: URLRequest
    ) async -> URLRequest? {
        nil
    }
}

/// The session's one keychain record (`@hazel/auth/desktop`'s vault): JSON the shell never reads.
enum Vault {
    private static var query: [CFString: Any] { [
        kSecClass: kSecClassGenericPassword,
        kSecAttrService: "sh.hazel.auth",
        kSecAttrAccount: "session",
    ] }

    static func read() -> String? {
        #if targetEnvironment(simulator)
        // The simulator's keychain refuses an app signed without entitlements (`run.sh` signs none).
        return UserDefaults.standard.string(forKey: "sh.hazel.auth.session")
        #endif
        var lookup = query
        lookup[kSecReturnData] = true
        lookup[kSecMatchLimit] = kSecMatchLimitOne
        var result: CFTypeRef?
        guard SecItemCopyMatching(lookup as CFDictionary, &result) == errSecSuccess, let data = result as? Data else {
            return nil
        }
        return String(decoding: data, as: UTF8.self)
    }

    static func write(_ record: String) -> Bool {
        #if targetEnvironment(simulator)
        UserDefaults.standard.set(record, forKey: "sh.hazel.auth.session")
        return true
        #endif
        let data = Data(record.utf8)
        let update: [CFString: Any] = [kSecValueData: data]
        let status = SecItemUpdate(query as CFDictionary, update as CFDictionary)
        if status == errSecSuccess { return true }
        guard status == errSecItemNotFound else {
            NSLog("[host] vault write failed: %d", status)
            return false
        }
        var add = query
        add[kSecValueData] = data
        add[kSecAttrAccessible] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
        let added = SecItemAdd(add as CFDictionary, nil)
        if added != errSecSuccess { NSLog("[host] vault write failed: %d (update %d)", added, status) }
        return added == errSecSuccess
    }
}

/// Where the page may go. It is the app, so it never leaves: a load of the web app's own pages (a
/// reload, a sign-in redirect) loads the bundled page there instead, and any other page opens in
/// the browser.
@MainActor
final class PageNavigation: NSObject, WKNavigationDelegate, WKUIDelegate {
    /// The next navigation is the bundled page itself (`WebBridge.loadPage`).
    static var isLoadingPage = false
    var load: ((URL) -> Void)?

    func webView(
        _ webView: WKWebView,
        decidePolicyFor action: WKNavigationAction,
        decisionHandler: @escaping @MainActor @Sendable (WKNavigationActionPolicy) -> Void
    ) {
        guard action.targetFrame?.isMainFrame == true, let url = action.request.url else {
            return decisionHandler(.allow)
        }
        if Self.isLoadingPage {
            Self.isLoadingPage = false
            return decisionHandler(.allow)
        }
        switch url.scheme {
        case "http", "https":
            decisionHandler(.cancel)
            if url.host == HostBridge.pageOrigin.host { load?(url) } else { UIApplication.shared.open(url) }
        case SchemeHandler.scheme, "about", "data", "blob":
            decisionHandler(.allow)
        default:
            // mailto:, tel:, other apps.
            decisionHandler(.cancel)
            UIApplication.shared.open(url)
        }
    }

    /// `target="_blank"` and `window.open`: the browser.
    func webView(
        _ webView: WKWebView,
        createWebViewWith configuration: WKWebViewConfiguration,
        for action: WKNavigationAction,
        windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
        if let url = action.request.url { UIApplication.shared.open(url) }
        return nil
    }
}
