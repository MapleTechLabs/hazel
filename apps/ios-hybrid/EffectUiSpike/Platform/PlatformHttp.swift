import Foundation
import JavaScriptCore

/// HTTP for Effect's `HttpClient` (`packages/client-data/src/platform/jsc/http-client.ts`) over
/// URLSession. Bodies cross the bridge as base64; the response is read whole.
final class PlatformHttp: @unchecked Sendable {
    private let perform: HazelPlatform.Perform
    private let session = URLSession(configuration: .ephemeral)
    private let lock = NSLock()
    private var tasks: [Int: URLSessionDataTask] = [:]
    private var nextId = 1

    init(perform: @escaping HazelPlatform.Perform) { self.perform = perform }

    func object(in context: JSContext) -> JSValue {
        let request: @convention(block) (String, String, [String: String], JSValue, JSValue) -> Int = {
            [weak self] method, url, headers, body, done in
            guard let self else { return 0 }
            let bodyBase64 = body.isString ? body.toString() : nil
            return self.request(method, url, headers, bodyBase64, JSCallback(done, perform: self.perform))
        }
        let cancel: @convention(block) (Int) -> Void = { [weak self] id in self?.take(id)?.cancel() }
        let object = JSValue(newObjectIn: context)!
        object.setObject(request, forKeyedSubscript: "request" as NSString)
        object.setObject(cancel, forKeyedSubscript: "cancel" as NSString)
        return object
    }

    private func request(
        _ method: String,
        _ url: String,
        _ headers: [String: String],
        _ bodyBase64: String?,
        _ done: JSCallback
    ) -> Int {
        guard let target = URL(string: url) else {
            done.call([NSNull(), "Invalid URL: \(url)"])
            return 0
        }
        var request = URLRequest(url: target)
        request.httpMethod = method
        for (name, value) in headers { request.setValue(value, forHTTPHeaderField: name) }
        if let bodyBase64 { request.httpBody = Data(base64Encoded: bodyBase64) }

        lock.lock()
        let id = nextId
        nextId += 1
        lock.unlock()
        let task = session.dataTask(with: request) { [weak self] data, response, error in
            // A cancelled request answers nobody: JS already moved on.
            guard self?.take(id) != nil else { return }
            guard let response = response as? HTTPURLResponse, error == nil else {
                done.call([NSNull(), error?.localizedDescription ?? "No HTTP response"])
                return
            }
            var fields: [String: String] = [:]
            for (name, value) in response.allHeaderFields {
                fields[String(describing: name).lowercased()] = String(describing: value)
            }
            let result: [String: Any] = [
                "status": response.statusCode,
                "url": response.url?.absoluteString ?? url,
                "headers": fields,
                "bodyBase64": (data ?? Data()).base64EncodedString(),
            ]
            done.call([result, NSNull()])
        }
        lock.lock()
        tasks[id] = task
        lock.unlock()
        task.resume()
        return id
    }

    private func take(_ id: Int) -> URLSessionDataTask? {
        lock.lock()
        defer { lock.unlock() }
        return tasks.removeValue(forKey: id)
    }
}
