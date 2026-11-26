import OSLog
import QuartzCore
import UIKit

/// Every display frame at up to 120 Hz, a dropped frame being one that took longer than its slot
/// (ported from `HazelHybrid/FrameMonitor.swift`). Logs `[frames]` per second with drops or batches,
/// and totals per named window (`begin` / `end`) for the G4 frame test.
@MainActor
final class FrameMonitor {
    static let shared = FrameMonitor()
    private static let log = Logger(subsystem: "sh.hazel.effect-ui-spike", category: "frames")

    struct Totals { var frames = 0, drops = 0, worst: CFTimeInterval = 0 }

    private var link: CADisplayLink?
    private var last: CFTimeInterval = 0
    private var windowStart: CFTimeInterval = 0
    private var second = Totals()
    private var named: (label: String, totals: Totals)?
    private var bridgeTime: CFTimeInterval = 0
    private var bridgeWorst: CFTimeInterval = 0
    private var bridgeMessages = 0

    func start() {
        guard link == nil else { return }
        let link = CADisplayLink(target: self, selector: #selector(tick(_:)))
        link.preferredFrameRateRange = CAFrameRateRange(minimum: 80, maximum: 120, preferred: 120)
        link.add(to: .main, forMode: .common)
        self.link = link
    }

    /// Main-thread time spent applying one batch.
    func noteBridge(_ seconds: CFTimeInterval) {
        bridgeTime += seconds
        bridgeWorst = max(bridgeWorst, seconds)
        bridgeMessages += 1
    }

    func begin(_ label: String) { named = (label, Totals()) }

    @discardableResult
    func end() -> Totals {
        guard let named else { return Totals() }
        self.named = nil
        Self.log.log(
            "[frames] window \(named.label, privacy: .public): \(named.totals.frames, privacy: .public) frames, drops \(named.totals.drops, privacy: .public), worst \(String(format: "%.1f", named.totals.worst * 1000), privacy: .public)ms"
        )
        return named.totals
    }

    @objc private func tick(_ link: CADisplayLink) {
        let now = link.timestamp
        let slot = link.targetTimestamp - link.timestamp
        if last > 0 {
            let delta = now - last
            // Longer than one and a half slots: at least one frame was missed.
            let dropped = delta > slot * 1.5 ? Int((delta / slot).rounded()) - 1 : 0
            second.frames += 1
            second.drops += dropped
            second.worst = max(second.worst, delta)
            if named != nil {
                named!.totals.frames += 1
                named!.totals.drops += dropped
                named!.totals.worst = max(named!.totals.worst, delta)
            }
        }
        last = now
        if windowStart == 0 { windowStart = now }
        if now - windowStart >= 1 {
            if second.drops > 0 || bridgeMessages > 0 || named != nil {
                Self.log.log(
                    "[frames] \(self.second.frames, privacy: .public) frames @\(Int((1 / slot).rounded()), privacy: .public)Hz, drops \(self.second.drops, privacy: .public), worst \(String(format: "%.1f", self.second.worst * 1000), privacy: .public)ms | bridge \(self.bridgeMessages, privacy: .public) msgs \(String(format: "%.1f", self.bridgeTime * 1000), privacy: .public)ms, worst \(String(format: "%.1f", self.bridgeWorst * 1000), privacy: .public)ms"
                )
            }
            windowStart = now
            second = Totals()
            bridgeTime = 0
            bridgeWorst = 0
            bridgeMessages = 0
        }
    }
}
