import OSLog
import QuartzCore
import UIKit

/// The performance bar, measured: every display frame at up to 120 Hz, a dropped frame being one
/// that took longer than its slot. Each second with movement logs `[frames]`: frames, drops, the
/// worst frame, and the main thread's time in bridge messages (`[frames] … bridge`).
@MainActor
final class FrameMonitor {
    static let shared = FrameMonitor()
    private static let log = Logger(subsystem: "sh.hazel.hybrid", category: "frames")

    private var link: CADisplayLink?
    private var last: CFTimeInterval = 0
    private var windowStart: CFTimeInterval = 0
    private var frames = 0
    private var drops = 0
    private var worst: CFTimeInterval = 0
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

    /// Main-thread time spent handling one bridge message.
    func noteBridge(_ seconds: CFTimeInterval) {
        bridgeTime += seconds
        bridgeWorst = max(bridgeWorst, seconds)
        bridgeMessages += 1
    }

    @objc private func tick(_ link: CADisplayLink) {
        let now = link.timestamp
        let slot = link.targetTimestamp - link.timestamp
        if last > 0 {
            let delta = now - last
            frames += 1
            worst = max(worst, delta)
            // Longer than one and a half slots: at least one frame was missed.
            if delta > slot * 1.5 { drops += Int((delta / slot).rounded()) - 1 }
        }
        last = now
        if windowStart == 0 { windowStart = now }
        if now - windowStart >= 1 {
            if drops > 0 || bridgeMessages > 0 || worst > slot * 1.2 {
                Self.log.log(
                    "[frames] \(self.frames, privacy: .public) frames @\(Int((1 / slot).rounded()), privacy: .public)Hz, drops \(self.drops, privacy: .public), worst \(String(format: "%.1f", self.worst * 1000), privacy: .public)ms | bridge \(self.bridgeMessages, privacy: .public) msgs \(String(format: "%.1f", self.bridgeTime * 1000), privacy: .public)ms, worst \(String(format: "%.1f", self.bridgeWorst * 1000), privacy: .public)ms"
                )
            }
            windowStart = now
            frames = 0
            drops = 0
            worst = 0
            bridgeTime = 0
            bridgeWorst = 0
            bridgeMessages = 0
        }
    }
}
