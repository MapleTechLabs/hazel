import UniformTypeIdentifiers
import WebKit

/// Serves the bundled web build at `hazel://app/…`. A path with no file of its own (an app route,
/// `/hazel/chat/…`) gets `index.html`, as the web host's not-found handling does.
final class SchemeHandler: NSObject, WKURLSchemeHandler {
    static let scheme = "hazel"
    static let startURL = URL(string: "hazel://app/")!

    private let root: URL = Bundle.main.resourceURL!.appendingPathComponent("web")
    /// Tasks WebKit stopped (a picture scrolled away): never answered after that.
    private var stopped = Set<ObjectIdentifier>()

    func webView(_ webView: WKWebView, start task: any WKURLSchemeTask) {
        guard let url = task.request.url else { return }
        if let remote = RemotePicture.original(of: url) {
            proxy(remote, for: task)
            return
        }
        var file = root.appendingPathComponent(url.path)
        var isDirectory: ObjCBool = false
        if !FileManager.default.fileExists(atPath: file.path, isDirectory: &isDirectory) || isDirectory.boolValue {
            file = root.appendingPathComponent("index.html")
        }
        guard let data = try? Data(contentsOf: file) else {
            task.didFailWithError(URLError(.fileDoesNotExist))
            return
        }
        let mime = UTType(filenameExtension: file.pathExtension)?.preferredMIMEType ?? "application/octet-stream"
        let response = HTTPURLResponse(
            url: url,
            statusCode: 200,
            httpVersion: "HTTP/1.1",
            headerFields: [
                "Content-Type": mime == "text/javascript" ? "application/javascript" : mime,
                "Content-Length": String(data.count),
                "Access-Control-Allow-Origin": "*",
            ]
        )!
        task.didReceive(response)
        task.didReceive(data)
        task.didFinish()
    }

    func webView(_ webView: WKWebView, stop task: any WKURLSchemeTask) {
        stopped.insert(ObjectIdentifier(task))
    }

    /// A picture from a host that refuses pages with no web origin, fetched as the web app.
    private func proxy(_ remote: URL, for schemeTask: any WKURLSchemeTask) {
        // Answered on the main thread only, where WebKit hands tasks out.
        nonisolated(unsafe) let task = schemeTask
        URLSession.shared.dataTask(with: RemotePicture.request(remote)) { [weak self] data, response, error in
            DispatchQueue.main.async {
                guard let self, self.stopped.remove(ObjectIdentifier(task)) == nil else { return }
                guard let data, let http = response as? HTTPURLResponse, (200..<300).contains(http.statusCode) else {
                    task.didFailWithError(error ?? URLError(.badServerResponse))
                    return
                }
                task.didReceive(HTTPURLResponse(
                    url: task.request.url!,
                    statusCode: 200,
                    httpVersion: "HTTP/1.1",
                    headerFields: [
                        "Content-Type": http.value(forHTTPHeaderField: "Content-Type") ?? "application/octet-stream",
                        "Content-Length": String(data.count),
                        "Cache-Control": "max-age=86400",
                    ]
                )!)
                task.didReceive(data)
                task.didFinish()
            }
        }.resume()
    }
}

/// Pictures from hosts that serve only web apps they know (Brandfetch's logo CDN): the page asks the
/// shell for them (`hazel://app/__remote?u=…`, `web/bridge.ts`), and the shell fetches them with the
/// web app's own origin as the referrer, as a browser on the web app would.
enum RemotePicture {
    static let hosts: Set<String> = ["cdn.brandfetch.io"]
    private static let referrer = "https://app.hazel.sh/"

    /// The picture `url` stands for, when it is a proxied one.
    static func original(of url: URL) -> URL? {
        guard url.scheme == SchemeHandler.scheme, url.path == "/__remote",
              let value = URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems?.first(where: { $0.name == "u" })?.value,
              let remote = URL(string: value), let host = remote.host, hosts.contains(host)
        else { return nil }
        return remote
    }

    static func request(_ url: URL) -> URLRequest {
        var request = URLRequest(url: url)
        request.cachePolicy = .returnCacheDataElseLoad
        if let host = url.host, hosts.contains(host) {
            request.setValue(referrer, forHTTPHeaderField: "Referer")
        }
        return request
    }
}
