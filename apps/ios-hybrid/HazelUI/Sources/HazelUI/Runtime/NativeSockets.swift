import Foundation
import JavaScriptCore

/// `WebSocketLike` sockets over `URLSessionWebSocketTask`: text and binary frames, subprotocols,
/// close codes. Each socket reports `open`, `message`, `close` and `error` to its JS callback; a
/// binary frame arrives as an `ArrayBuffer`.
final class NativeSockets: NSObject, URLSessionWebSocketDelegate, @unchecked Sendable {
    private struct Entry {
        let task: URLSessionWebSocketTask
        let onEvent: JSCallback
    }

    private let pump: JSCallbackPump
    private let lock = NSLock()
    private var entries: [Int: Entry] = [:]
    private var byTask: [Int: Int] = [:]
    private var nextId = 1
    private var session: URLSession!

    init(pump: JSCallbackPump) {
        self.pump = pump
        super.init()
        session = URLSession(configuration: .default, delegate: self, delegateQueue: nil)
    }

    /// Closes every socket and stops taking new ones (the runtime is being replaced).
    func shutdown() {
        lock.lock()
        let open = entries.values.map(\.task)
        entries = [:]
        byTask = [:]
        lock.unlock()
        for task in open { task.cancel(with: .goingAway, reason: nil) }
        session.invalidateAndCancel()
    }

    func object(in context: JSContext) -> JSValue {
        let open: @convention(block) (String, [String], JSValue) -> Int = { [weak self] url, protocols, onEvent in
            guard let self else { return 0 }
            return self.open(url, protocols, JSCallback(onEvent, pump: self.pump))
        }
        let send: @convention(block) (Int, JSValue) -> Void = { [weak self] id, data in
            if data.isString, let text = data.toString() {
                self?.send(id, .string(text))
            } else if let bytes = JSBytes.data(data) {
                self?.send(id, .data(bytes))
            }
        }
        let close: @convention(block) (Int, Int, String) -> Void = { [weak self] id, code, reason in
            self?.close(id, code, reason)
        }
        let object = JSValue(newObjectIn: context)!
        object.setObject(open, forKeyedSubscript: "open" as NSString)
        object.setObject(send, forKeyedSubscript: "send" as NSString)
        object.setObject(close, forKeyedSubscript: "close" as NSString)
        object.setObject(true, forKeyedSubscript: "binary" as NSString)
        return object
    }

    private func open(_ url: String, _ protocols: [String], _ onEvent: JSCallback) -> Int {
        guard let target = URL(string: url) else {
            onEvent.call([["type": "close", "code": 1006, "reason": "Invalid URL"] as [String: any Sendable]])
            return 0
        }
        let task = session.webSocketTask(with: target, protocols: protocols)
        lock.lock()
        let id = nextId
        nextId += 1
        entries[id] = Entry(task: task, onEvent: onEvent)
        byTask[task.taskIdentifier] = id
        lock.unlock()
        task.resume()
        receive(id, task)
        return id
    }

    private func receive(_ id: Int, _ task: URLSessionWebSocketTask) {
        task.receive { [weak self] result in
            guard let self, case let .success(message) = result, let entry = self.entry(id) else { return }
            switch message {
            case let .string(text):
                entry.onEvent.call([["type": "message", "data": text] as [String: any Sendable]])
            case let .data(bytes):
                entry.onEvent.call { context in
                    [jsEvent("message", in: context, ["data": JSBytes.arrayBuffer(bytes, in: context)])]
                }
            @unknown default:
                break
            }
            self.receive(id, task)
        }
    }

    private func send(_ id: Int, _ message: URLSessionWebSocketTask.Message) {
        guard let entry = entry(id) else { return }
        entry.task.send(message) { error in
            if let error { NativePlatform.log.error("[socket] send failed: \(error, privacy: .public)") }
        }
    }

    /// A close from JS: the close frame goes out, and JS hears `close` now (the delegate may not).
    private func close(_ id: Int, _ code: Int, _ reason: String) {
        guard let entry = remove(id) else { return }
        let closeCode = URLSessionWebSocketTask.CloseCode(rawValue: code) ?? .normalClosure
        entry.task.cancel(with: closeCode, reason: reason.data(using: .utf8))
        entry.onEvent.call([["type": "close", "code": code, "reason": reason] as [String: any Sendable]])
    }

    private func entry(_ id: Int) -> Entry? {
        lock.lock()
        defer { lock.unlock() }
        return entries[id]
    }

    private func remove(_ id: Int) -> Entry? {
        lock.lock()
        defer { lock.unlock() }
        guard let entry = entries.removeValue(forKey: id) else { return nil }
        byTask[entry.task.taskIdentifier] = nil
        return entry
    }

    private func id(of task: URLSessionTask) -> Int? {
        lock.lock()
        defer { lock.unlock() }
        return byTask[task.taskIdentifier]
    }

    func urlSession(_: URLSession, webSocketTask: URLSessionWebSocketTask, didOpenWithProtocol protocolName: String?) {
        guard let id = id(of: webSocketTask) else { return }
        entry(id)?.onEvent.call([["type": "open", "protocol": protocolName ?? ""] as [String: any Sendable]])
    }

    func urlSession(
        _: URLSession,
        webSocketTask: URLSessionWebSocketTask,
        didCloseWith closeCode: URLSessionWebSocketTask.CloseCode,
        reason: Data?
    ) {
        guard let id = id(of: webSocketTask), let entry = remove(id) else { return }
        let text = reason.map { String(decoding: $0, as: UTF8.self) } ?? ""
        entry.onEvent.call([["type": "close", "code": closeCode.rawValue, "reason": text] as [String: any Sendable]])
    }

    /// The connection failed or dropped without a close frame: `error`, then `close` 1006.
    func urlSession(_: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let id = id(of: task), let entry = remove(id) else { return }
        let message = error?.localizedDescription ?? "The connection closed"
        entry.onEvent.call([["type": "error", "message": message] as [String: any Sendable]])
        entry.onEvent.call([["type": "close", "code": 1006, "reason": message] as [String: any Sendable]])
    }
}

/// HTTP for Effect's `HttpClient` (`packages/client-data/src/platform/jsc/http-client.ts`) over
/// URLSession: the head as soon as it arrives, then the body in the chunks URLSession hands over, as
/// `Uint8Array`s. Bodies go out as bytes read straight from the JS typed array.
final class NativeHttp: NSObject, URLSessionDataDelegate, @unchecked Sendable {
    private let pump: JSCallbackPump
    private let lock = NSLock()
    private var callbacks: [Int: JSCallback] = [:]
    private var tasks: [Int: URLSessionDataTask] = [:]
    private var byTask: [Int: Int] = [:]
    private var nextId = 1
    private var session: URLSession!

    init(pump: JSCallbackPump) {
        self.pump = pump
        super.init()
        // No cookie jar or cache of its own: the API's session travels as a bearer.
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpCookieStorage = nil
        configuration.httpShouldSetCookies = false
        session = URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
    }

    /// Cancels every request in flight; none answers (the runtime is being replaced).
    func shutdown() {
        lock.lock()
        let running = Array(tasks.values)
        tasks = [:]
        byTask = [:]
        callbacks = [:]
        lock.unlock()
        for task in running { task.cancel() }
        session.invalidateAndCancel()
    }

    func object(in context: JSContext) -> JSValue {
        let start: @convention(block) (String, String, [String: String], JSValue, JSValue) -> Int = {
            [weak self] method, url, headers, body, onEvent in
            guard let self else { return 0 }
            return self.start(method, url, headers, JSBytes.data(body), JSCallback(onEvent, pump: self.pump))
        }
        let cancel: @convention(block) (Int) -> Void = { [weak self] id in self?.take(id)?.task?.cancel() }
        let object = JSValue(newObjectIn: context)!
        object.setObject(start, forKeyedSubscript: "start" as NSString)
        object.setObject(cancel, forKeyedSubscript: "cancel" as NSString)
        return object
    }

    private func start(
        _ method: String,
        _ url: String,
        _ headers: [String: String],
        _ body: Data?,
        _ onEvent: JSCallback
    ) -> Int {
        guard let target = URL(string: url) else {
            onEvent.call([["type": "error", "message": "Invalid URL: \(url)"] as [String: any Sendable]])
            return 0
        }
        var request = URLRequest(url: target)
        request.httpMethod = method
        for (name, value) in headers { request.setValue(value, forHTTPHeaderField: name) }
        request.httpBody = body
        let task = session.dataTask(with: request)
        lock.lock()
        let id = nextId
        nextId += 1
        callbacks[id] = onEvent
        tasks[id] = task
        byTask[task.taskIdentifier] = id
        lock.unlock()
        task.resume()
        return id
    }

    /// Forgets a request: a cancelled one answers nobody (JS already moved on).
    private func take(_ id: Int) -> (task: URLSessionDataTask?, callback: JSCallback?)? {
        lock.lock()
        defer { lock.unlock() }
        guard let task = tasks.removeValue(forKey: id) else { return nil }
        byTask[task.taskIdentifier] = nil
        return (task, callbacks.removeValue(forKey: id))
    }

    private func callback(for task: URLSessionTask) -> JSCallback? {
        lock.lock()
        defer { lock.unlock() }
        return byTask[task.taskIdentifier].flatMap { callbacks[$0] }
    }

    func urlSession(
        _: URLSession,
        dataTask: URLSessionDataTask,
        didReceive response: URLResponse,
        completionHandler: @escaping @Sendable (URLSession.ResponseDisposition) -> Void
    ) {
        if let callback = callback(for: dataTask), let http = response as? HTTPURLResponse {
            var fields: [String: String] = [:]
            for (name, value) in http.allHeaderFields {
                fields[String(describing: name).lowercased()] = String(describing: value)
            }
            let url = http.url?.absoluteString ?? ""
            callback.call([
                ["type": "head", "status": http.statusCode, "url": url, "headers": fields] as [String: any Sendable],
            ])
        }
        completionHandler(.allow)
    }

    /// A redirect is answered as it is, never followed, as a fetch with `redirect: "error"`: the
    /// auth API's native mode and the RPC endpoints never redirect a request that is right.
    func urlSession(
        _: URLSession,
        task _: URLSessionTask,
        willPerformHTTPRedirection _: HTTPURLResponse,
        newRequest _: URLRequest
    ) async -> URLRequest? {
        nil
    }

    func urlSession(_: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
        callback(for: dataTask)?.call { context in
            [jsEvent("chunk", in: context, ["data": JSBytes.uint8Array(data, in: context)])]
        }
    }

    func urlSession(_: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        lock.lock()
        let id = byTask[task.taskIdentifier]
        lock.unlock()
        guard let id, let callback = take(id)?.callback else { return }
        if let error {
            callback.call([["type": "error", "message": error.localizedDescription] as [String: any Sendable]])
        } else {
            callback.call([["type": "end"] as [String: any Sendable]])
        }
    }
}
