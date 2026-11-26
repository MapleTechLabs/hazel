import Foundation
import JavaScriptCore
import Network

/// `Connectivity` over `NWPathMonitor`: listeners hear each return to a satisfied path, as the web's
/// `online` event.
final class PlatformConnectivity: @unchecked Sendable {
    private let perform: HazelPlatform.Perform
    private let monitor = NWPathMonitor()
    private let lock = NSLock()
    private var listeners: [Int: JSCallback] = [:]
    private var nextId = 1
    private var satisfied: Bool?

    init(perform: @escaping HazelPlatform.Perform) {
        self.perform = perform
        monitor.pathUpdateHandler = { [weak self] path in self?.update(path.status == .satisfied) }
        monitor.start(queue: DispatchQueue(label: "sh.hazel.platform.connectivity"))
    }

    func object(in context: JSContext) -> JSValue {
        let on: @convention(block) (JSValue) -> Int = { [weak self] listener in
            guard let self else { return 0 }
            return self.add(JSCallback(listener, perform: self.perform))
        }
        let off: @convention(block) (Int) -> Void = { [weak self] id in self?.remove(id) }
        let object = JSValue(newObjectIn: context)!
        object.setObject(on, forKeyedSubscript: "onOnline" as NSString)
        object.setObject(off, forKeyedSubscript: "off" as NSString)
        return object
    }

    private func update(_ now: Bool) {
        lock.lock()
        let wasOffline = satisfied == false
        satisfied = now
        let toCall = now && wasOffline ? Array(listeners.values) : []
        lock.unlock()
        if !toCall.isEmpty { HazelPlatform.log.log("[platform] network back, \(toCall.count) listeners") }
        for listener in toCall { listener.call([]) }
    }

    private func add(_ listener: JSCallback) -> Int {
        lock.lock()
        defer { lock.unlock() }
        let id = nextId
        nextId += 1
        listeners[id] = listener
        return id
    }

    private func remove(_ id: Int) {
        lock.lock()
        listeners[id] = nil
        lock.unlock()
    }
}
