import QuartzCore
import UIKit

/// Every display frame at up to 120 Hz (after `apps/ios-hybrid/HazelHybrid/FrameMonitor.swift`). A
/// dropped frame is a gap longer than one and a half slots; totals accumulate until `reset()`.
@MainActor
public final class FrameMonitor {
    public struct Totals: Sendable {
        public var frames = 0
        public var drops = 0
        /// Frames that missed their slot at all (any gap over 1.5 slots), and the worst gap.
        public var longFrames = 0
        public var worstMs: Double = 0
        public var hz = 0
        /// Main-thread busy time per run-loop turn (woke to went idle): what a 120 Hz frame must fit
        /// in 8.3 ms, measurable even where the display runs at 60 Hz (the simulator).
        public var busyWorstMs: Double = 0
        public var busyOver8ms = 0
        public var busyOver4ms = 0
    }

    public static let shared = FrameMonitor()
    public private(set) var totals = Totals()
    /// Counts only while true (a scroll in progress, say), so idle seconds do not dilute the totals.
    public var counting = true
    private var link: CADisplayLink?
    private var last: CFTimeInterval = 0
    private var observer: CFRunLoopObserver?
    private var woke: CFTimeInterval = 0

    public func start() {
        guard link == nil else { return }
        let link = CADisplayLink(target: self, selector: #selector(tick(_:)))
        link.preferredFrameRateRange = CAFrameRateRange(minimum: 80, maximum: 120, preferred: 120)
        link.add(to: .main, forMode: .common)
        self.link = link
        let activities = CFRunLoopActivity.afterWaiting.rawValue | CFRunLoopActivity.beforeWaiting.rawValue
        let observer = CFRunLoopObserverCreateWithHandler(nil, activities, true, 0) { _, activity in
            MainActor.assumeIsolated { FrameMonitor.shared.runLoop(activity) }
        }
        CFRunLoopAddObserver(CFRunLoopGetMain(), observer, .commonModes)
        self.observer = observer
    }

    private func runLoop(_ activity: CFRunLoopActivity) {
        let now = CACurrentMediaTime()
        if activity == .afterWaiting {
            woke = now
            return
        }
        guard counting, woke > 0 else { return }
        let busy = (now - woke) * 1000
        woke = 0
        totals.busyWorstMs = max(totals.busyWorstMs, busy)
        if busy > 8.33 { totals.busyOver8ms += 1 }
        if busy > 4 { totals.busyOver4ms += 1 }
    }

    public func reset() {
        totals = Totals()
        last = 0
    }

    @objc private func tick(_ link: CADisplayLink) {
        let now = link.timestamp
        let slot = link.targetTimestamp - link.timestamp
        defer { last = now }
        guard counting, last > 0, slot > 0 else { return }
        let delta = now - last
        totals.frames += 1
        totals.hz = Int((1 / slot).rounded())
        totals.worstMs = max(totals.worstMs, delta * 1000)
        if delta > slot * 1.5 {
            totals.longFrames += 1
            totals.drops += Int((delta / slot).rounded()) - 1
        }
    }
}
