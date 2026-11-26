import Foundation

/// The one thread JavaScriptCore runs on (G4): a `Thread` with its own run loop. Work arrives as run
/// loop blocks (`perform`) and timers; nothing on it ever waits for the main thread.
final class JSThread: Thread, @unchecked Sendable {
    private var runLoop: CFRunLoop?
    private let started = DispatchSemaphore(value: 0)

    override init() {
        super.init()
        name = "sh.hazel.js"
        qualityOfService = .userInitiated
        stackSize = 8 << 20
    }

    /// Starts the thread and waits for its run loop to exist (thread startup, not JS).
    func launch() {
        start()
        started.wait()
    }

    override func main() {
        runLoop = CFRunLoopGetCurrent()
        // A port keeps the run loop alive while no timer or block is queued.
        RunLoop.current.add(Port(), forMode: .default)
        started.signal()
        while !isCancelled {
            _ = RunLoop.current.run(mode: .default, before: .distantFuture)
        }
    }

    /// Queues `block` on the JS thread's run loop and returns at once.
    func perform(_ block: @escaping @Sendable () -> Void) {
        guard let runLoop else { return }
        CFRunLoopPerformBlock(runLoop, CFRunLoopMode.defaultMode.rawValue, block)
        CFRunLoopWakeUp(runLoop)
    }

    /// A timer on the JS thread's run loop; call from the JS thread. `interval` 0 fires once.
    func timer(after seconds: Double, interval: Double, _ fire: @escaping () -> Void) -> CFRunLoopTimer? {
        let timer = CFRunLoopTimerCreateWithHandler(
            kCFAllocatorDefault, CFAbsoluteTimeGetCurrent() + max(seconds, 0), interval, 0, 0
        ) { _ in fire() }
        CFRunLoopAddTimer(CFRunLoopGetCurrent(), timer, .defaultMode)
        return timer
    }
}
