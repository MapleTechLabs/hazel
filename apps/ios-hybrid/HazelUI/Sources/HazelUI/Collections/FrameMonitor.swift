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
    }

    public static let shared = FrameMonitor()
    public private(set) var totals = Totals()
    /// Counts only while true (a scroll in progress, say), so idle seconds do not dilute the totals.
    public var counting = true
    private var link: CADisplayLink?
    private var last: CFTimeInterval = 0

    public func start() {
        guard link == nil else { return }
        let link = CADisplayLink(target: self, selector: #selector(tick(_:)))
        link.preferredFrameRateRange = CAFrameRateRange(minimum: 80, maximum: 120, preferred: 120)
        link.add(to: .main, forMode: .common)
        self.link = link
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
