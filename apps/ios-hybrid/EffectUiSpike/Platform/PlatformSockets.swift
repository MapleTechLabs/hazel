import Foundation
import JavaScriptCore

/// `WebSocketLike` sockets over `URLSessionWebSocketTask`: text frames, subprotocols, close codes.
/// Each socket reports `open`, `message`, `close` and `error` events to its JS callback.
final class PlatformSockets: NSObject, URLSessionWebSocketDelegate, @unchecked Sendable {
    private struct Entry {
        let task: URLSessionWebSocketTask
        let onEvent: JSCallback
    }

    private let perform: HazelPlatform.Perform
    private let lock = NSLock()
    private var entries: [Int: Entry] = [:]
    private var byTask: [Int: Int] = [:]
    private var nextId = 1
    private var session: URLSession!

    init(perform: @escaping HazelPlatform.Perform) {
        self.perform = perform
        super.init()
        session = URLSession(configuration: .default, delegate: self, delegateQueue: nil)
    }

    func object(in context: JSContext) -> JSValue {
        let open: @convention(block) (String, [String], JSValue) -> Int = { [weak self] url, protocols, onEvent in
            guard let self else { return 0 }
            return self.open(url, protocols, JSCallback(onEvent, perform: self.perform))
        }
        let send: @convention(block) (Int, String) -> Void = { [weak self] id, data in self?.send(id, data) }
        let close: @convention(block) (Int, Int, String) -> Void = { [weak self] id, code, reason in
            self?.close(id, code, reason)
        }
        let object = JSValue(newObjectIn: context)!
        object.setObject(open, forKeyedSubscript: "open" as NSString)
        object.setObject(send, forKeyedSubscript: "send" as NSString)
        object.setObject(close, forKeyedSubscript: "close" as NSString)
        return object
    }

    private func open(_ url: String, _ protocols: [String], _ onEvent: JSCallback) -> Int {
        guard let target = URL(string: url) else {
            onEvent.call([["type": "close", "code": 1006, "reason": "Invalid URL"]])
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
            guard let self, case let .success(message) = result else { return }
            let data: String
            switch message {
            case let .string(text): data = text
            case let .data(bytes): data = String(decoding: bytes, as: UTF8.self)
            @unknown default: return
            }
            self.entry(id)?.onEvent.call([["type": "message", "data": data]])
            self.receive(id, task)
        }
    }

    private func send(_ id: Int, _ data: String) {
        guard let entry = entry(id) else { return }
        entry.task.send(.string(data)) { error in
            if let error { HazelPlatform.log.error("[socket] send failed: \(error, privacy: .public)") }
        }
    }

    /// A close from JS: the close frame goes out, and JS hears `close` now (the delegate may not).
    private func close(_ id: Int, _ code: Int, _ reason: String) {
        guard let entry = remove(id) else { return }
        let closeCode = URLSessionWebSocketTask.CloseCode(rawValue: code) ?? .normalClosure
        entry.task.cancel(with: closeCode, reason: reason.data(using: .utf8))
        entry.onEvent.call([["type": "close", "code": code, "reason": reason]])
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
        entry(id)?.onEvent.call([["type": "open", "protocol": protocolName ?? ""]])
    }

    func urlSession(
        _: URLSession,
        webSocketTask: URLSessionWebSocketTask,
        didCloseWith closeCode: URLSessionWebSocketTask.CloseCode,
        reason: Data?
    ) {
        guard let id = id(of: webSocketTask), let entry = remove(id) else { return }
        let text = reason.map { String(decoding: $0, as: UTF8.self) } ?? ""
        entry.onEvent.call([["type": "close", "code": closeCode.rawValue, "reason": text]])
    }

    /// The connection failed or dropped without a close frame: `error`, then `close` 1006.
    func urlSession(_: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
        guard let id = id(of: task), let entry = remove(id) else { return }
        let message = error?.localizedDescription ?? "The connection closed"
        entry.onEvent.call([["type": "error", "message": message]])
        entry.onEvent.call([["type": "close", "code": 1006, "reason": message]])
    }
}
