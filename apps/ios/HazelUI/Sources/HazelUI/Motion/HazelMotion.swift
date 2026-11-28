import QuartzCore
import SwiftUI
import UIKit

// The motion layer on iOS (`packages/ui/MOTION.md`). A renderer says when a motion plays; what plays
// (keyframes, duration, curve, delay, repeat) is only ever read from `HazelTheme.Motion`.

public enum HazelMotion {
    typealias Spec = HazelTheme.Motion.Spec
    typealias Trigger = HazelTheme.Motion.Trigger

    /// Off under XCTest unless a test turns it on, so snapshots draw the settled state.
    @MainActor public static var enabled = ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] == nil
    /// A test's stand-in for the system's Reduce Motion; nil reads the system's.
    @MainActor public static var reduceOverride: Bool?

    /// Reduce Motion as a player sees it: the override, else the environment's or the system's value.
    @MainActor static func reduced(_ environment: Bool? = nil) -> Bool {
        reduceOverride ?? environment ?? UIAccessibility.isReduceMotionEnabled
    }

    /// The motion `tag`'s recipe plays on `part` (nil: the root) for `trigger`, its `regular`
    /// override in the regular size class; nil when the recipe plays none there.
    static func spec(
        _ tag: String, _ trigger: Trigger, part: String? = nil, backdrop: Bool = false,
        sizeClass: HazelTheme.SizeClass = .compact
    ) -> Spec? {
        guard let use = HazelTheme.Motion.uses[tag]?.first(where: {
            $0.trigger == trigger && $0.part == part && $0.backdrop == backdrop
        }) else { return nil }
        return sizeClass == .regular ? use.regular ?? use.motion : use.motion
    }
}

// MARK: timeline

extension HazelTheme.Motion.Pose {
    /// Where every motion settles: the element as laid out.
    static let rest = Self(opacity: 1, x: .points(0), y: .points(0), scale: 1)
}

extension HazelTheme.Motion.Offset {
    /// The offset in points for an element `length` long on its axis.
    func points(_ length: CGFloat) -> CGFloat {
        switch self {
        case let .points(value): value
        case let .fraction(value): value * length
        }
    }
}

extension HazelTheme.Motion.Curve {
    func animation(duration: Double) -> Animation { .timingCurve(x1, y1, x2, y2, duration: duration) }
    var mediaTiming: CAMediaTimingFunction {
        CAMediaTimingFunction(controlPoints: Float(x1), Float(y1), Float(x2), Float(y2))
    }
}

/// A motion as steps between its keyframes, as CSS plays it: each segment eased by its keyframe's
/// curve (else the motion's), the first pose held through the delay (`both`), a loop jumping back to it.
public struct MotionTimeline: Equatable, Sendable {
    public typealias Pose = HazelTheme.Motion.Pose
    public typealias Curve = HazelTheme.Motion.Curve

    public struct Step: Equatable, Sendable {
        public let pose: Pose, duration: Double, curve: Curve
    }

    public let name: String
    public let start: Pose
    public let delay: Double
    public let steps: [Step]
    public let repeats: Bool

    public var end: Pose { steps.last?.pose ?? start }
    /// One pass, without the delay.
    public var duration: Double { steps.reduce(0) { $0 + $1.duration } }

    /// Nil under Reduce Motion for a loop, which then does not run. Otherwise Reduce Motion keeps
    /// the delay and jumps to the end pose in no time (MOTION.md, `reducedMotion: "instant"`).
    public init?(_ spec: HazelTheme.Motion.Spec, reduceMotion: Bool) {
        let frames = spec.keyframes.sorted { $0.at < $1.at }
        guard let first = frames.first, let last = frames.last else { return nil }
        if reduceMotion && spec.repeats { return nil }
        name = spec.name
        start = first.pose
        delay = spec.delay
        repeats = spec.repeats
        if reduceMotion {
            steps = [Step(pose: last.pose, duration: 0, curve: spec.curve)]
        } else {
            steps = zip(frames, frames.dropFirst()).map { from, to in
                Step(pose: to.pose, duration: (to.at - from.at) * spec.duration, curve: from.curve ?? spec.curve)
            }
        }
    }

    /// The same motion as a Core Animation group for a layer of `size` (no SwiftUI updates per frame).
    /// `flipped`: the layer draws in a y-flipped parent (the message list), so a rise is a positive y.
    public func layerAnimation(size: CGSize, flipped: Bool = false) -> CAAnimation {
        let total = max(duration, 0.0001)
        var times: [NSNumber] = [0]
        var elapsed = 0.0
        for step in steps {
            elapsed += step.duration
            times.append(NSNumber(value: min(1, elapsed / total)))
        }
        let poses = [start] + steps.map(\.pose)
        let curves = steps.map(\.curve.mediaTiming)
        func track(_ keyPath: String, _ value: (Pose) -> CGFloat) -> CAKeyframeAnimation {
            let animation = CAKeyframeAnimation(keyPath: keyPath)
            animation.values = poses.map(value)
            animation.keyTimes = times
            animation.timingFunctions = curves
            return animation
        }
        let sign: CGFloat = flipped ? -1 : 1
        let tracks: [(String, (Pose) -> CGFloat)] = [
            ("opacity", { CGFloat($0.opacity) }),
            ("transform.translation.x", { $0.x.points(size.width) }),
            ("transform.translation.y", { sign * $0.y.points(size.height) }),
            ("transform.scale", { CGFloat($0.scale) }),
        ]
        let group = CAAnimationGroup()
        // Only what moves: a constant `transform.scale` would also undo a flipped layer's own transform.
        group.animations = tracks
            .filter { _, value in Set(poses.map(value)).count > 1 }
            .map { track($0.0, $0.1) }
        group.duration = total
        group.fillMode = .backwards
        group.repeatCount = repeats ? .infinity : 1
        group.isRemovedOnCompletion = true
        return group
    }
}

/// A pose with each offset kept as points plus a fraction of the element's size, so poses in
/// different units interpolate (`countUp` goes from 70% of the height to 0 points).
public struct MotionFrame: Equatable, Sendable {
    public var opacity: Double, xPoints: CGFloat, xFraction: CGFloat, yPoints: CGFloat, yFraction: CGFloat, scale: CGFloat

    public static let rest = MotionFrame(HazelTheme.Motion.Pose.rest)

    public init(_ pose: HazelTheme.Motion.Pose) {
        opacity = pose.opacity
        (xPoints, xFraction) = Self.split(pose.x)
        (yPoints, yFraction) = Self.split(pose.y)
        scale = pose.scale
    }

    private static func split(_ offset: HazelTheme.Motion.Offset) -> (CGFloat, CGFloat) {
        switch offset {
        case let .points(value): (value, 0)
        case let .fraction(value): (0, value)
        }
    }

    func mix(_ to: MotionFrame, _ p: Double) -> MotionFrame {
        func lerp(_ a: CGFloat, _ b: CGFloat) -> CGFloat { a + (b - a) * p }
        var out = self
        out.opacity = opacity + (to.opacity - opacity) * p
        out.xPoints = lerp(xPoints, to.xPoints); out.xFraction = lerp(xFraction, to.xFraction)
        out.yPoints = lerp(yPoints, to.yPoints); out.yFraction = lerp(yFraction, to.yFraction)
        out.scale = lerp(scale, to.scale)
        return out
    }
}

extension HazelTheme.Motion.Curve {
    /// The CSS `cubic-bezier` at progress `x` (0 to 1): solves for the curve's parameter, then its y.
    public func value(at x: Double) -> Double {
        if x <= 0 { return 0 }
        if x >= 1 { return 1 }
        func sample(_ t: Double, _ a: Double, _ b: Double) -> Double {
            3 * a * t * (1 - t) * (1 - t) + 3 * b * t * t * (1 - t) + t * t * t
        }
        var lo = 0.0, hi = 1.0, t = x
        for _ in 0..<40 {
            let at = sample(t, x1, x2)
            if abs(at - x) < 1e-7 { break }
            if at < x { lo = t } else { hi = t }
            t = (lo + hi) / 2
        }
        return sample(t, y1, y2)
    }
}

extension MotionTimeline {
    /// The frame `time` seconds after the play started: the first pose through the delay, then
    /// each step eased by its curve; a loop wraps, a single play holds its end.
    public func frame(at time: Double) -> MotionFrame {
        var local = time - delay
        guard local > 0 else { return MotionFrame(start) }
        if repeats, duration > 0 { local = local.truncatingRemainder(dividingBy: duration) }
        var from = MotionFrame(start)
        for step in steps {
            let to = MotionFrame(step.pose)
            if local < step.duration {
                return from.mix(to, step.curve.value(at: local / step.duration))
            }
            local -= step.duration
            from = to
        }
        return from
    }

    /// Whether a single play is over `time` seconds after it started.
    public func isFinished(at time: Double) -> Bool { !repeats && time >= delay + duration }
}

// MARK: SwiftUI

/// One play of a motion: replaying the same spec needs a new `id`.
struct MotionCue: Equatable {
    let spec: HazelTheme.Motion.Spec
    let id: Int
}

/// A frame's translation (points plus a fraction of the view's own size) and scale about the centre.
private struct FrameEffect: GeometryEffect {
    let frame: MotionFrame

    var animatableData: EmptyAnimatableData {
        get { EmptyAnimatableData() }
        set {}
    }

    func effectValue(size: CGSize) -> ProjectionTransform {
        let tx = frame.xPoints + frame.xFraction * size.width, ty = frame.yPoints + frame.yFraction * size.height
        let transform = CGAffineTransform(translationX: tx + size.width / 2, y: ty + size.height / 2)
            .scaledBy(x: frame.scale, y: frame.scale)
            .translatedBy(x: -size.width / 2, y: -size.height / 2)
        return ProjectionTransform(transform)
    }
}

/// Plays `cue` on the view whenever it changes (and on appear when `onAppear`), frame by frame from
/// `HazelTheme.Motion`. The clock pauses at rest, and only this view's frame closure runs while it
/// plays; the content passed through is not re-evaluated, so siblings never redraw (G8).
struct MotionModifier: ViewModifier {
    let cue: MotionCue?
    var onAppear = true
    var onEnd: (() -> Void)?

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var playing: Playing?
    @State private var generation = 0

    struct Playing {
        let timeline: MotionTimeline
        let start: Date
    }

    func body(content: Content) -> some View {
        TimelineView(.animation(paused: playing == nil)) { context in
            let frame = playing.map { $0.timeline.frame(at: context.date.timeIntervalSince($0.start)) } ?? .rest
            content
                .opacity(frame.opacity)
                .modifier(FrameEffect(frame: frame))
        }
        .onAppear { if onAppear { play(cue) } }
        .onChange(of: cue) { _, now in play(now) }
        .onDisappear {
            generation += 1
            playing = nil
        }
    }

    private func play(_ cue: MotionCue?) {
        generation += 1
        let mine = generation
        guard HazelMotion.enabled, let cue,
              let timeline = MotionTimeline(cue.spec, reduceMotion: HazelMotion.reduced(reduceMotion))
        else {
            playing = nil
            if cue != nil { onEnd?() }
            return
        }
        playing = Playing(timeline: timeline, start: .now)
        guard !timeline.repeats else { return }
        Task {
            try? await Task.sleep(for: .seconds(timeline.delay + timeline.duration))
            guard mine == generation else { return }
            playing = nil
            onEnd?()
        }
    }
}

extension View {
    /// Plays the recipe's motion for `trigger` on this view when it appears: an enter.
    func hzEnter(_ tag: String, part: String? = nil, backdrop: Bool = false, sizeClass: HazelTheme.SizeClass) -> some View {
        let spec = HazelMotion.spec(tag, .enter, part: part, backdrop: backdrop, sizeClass: sizeClass)
        return modifier(MotionModifier(cue: spec.map { MotionCue(spec: $0, id: 0) }))
    }

    /// Runs the recipe's loop on this view while `running`; at rest otherwise (and under Reduce Motion).
    func hzLoop(_ tag: String, part: String, running: Bool = true) -> some View {
        let spec = running ? HazelMotion.spec(tag, .loop, part: part) : nil
        return modifier(MotionModifier(cue: spec.map { MotionCue(spec: $0, id: 0) }))
    }

    /// Rolls a count in from below when it rose and from above when it fell (`countUp`, `countDown`),
    /// clipped to its own box; a count appearing or going to zero just changes.
    func hzCountRoll(_ tag: String, part: String = "count", value: Int) -> some View {
        modifier(CountRoll(tag: tag, part: part, value: value)).clipped()
    }
}

private struct CountRoll: ViewModifier {
    let tag: String
    let part: String
    let value: Int
    @State private var cue: MotionCue?

    func body(content: Content) -> some View {
        content
            .modifier(MotionModifier(cue: cue, onAppear: false))
            .onChange(of: value) { old, new in
                guard old > 0, new > 0, old != new,
                      let spec = HazelMotion.spec(tag, new > old ? .countUp : .countDown, part: part)
                else { return }
                cue = MotionCue(spec: spec, id: (cue?.id ?? 0) + 1)
            }
    }
}

/// Shows `content` while `shown`, playing `tag`'s enter on show and its exit on hide; a hidden view
/// stays until its exit ends (as the web keeps an exiting toast). A reopen plays the enter again.
struct MotionPresence<Content: View>: View {
    let tag: String
    let part: String?
    let shown: Bool
    let sizeClass: HazelTheme.SizeClass
    let content: () -> Content

    @State private var present: Bool
    @State private var cue: MotionCue?

    init(tag: String, part: String?, shown: Bool, sizeClass: HazelTheme.SizeClass, @ViewBuilder content: @escaping () -> Content) {
        self.tag = tag
        self.part = part
        self.shown = shown
        self.sizeClass = sizeClass
        self.content = content
        // Shown from the first draw (snapshots, the first frame); its enter plays as it appears.
        _present = State(initialValue: shown)
        let enter = shown ? HazelMotion.spec(tag, .enter, part: part, sizeClass: sizeClass) : nil
        _cue = State(initialValue: enter.map { MotionCue(spec: $0, id: 1) })
    }

    var body: some View {
        Group {
            if present {
                content().modifier(MotionModifier(cue: cue) {
                    if !shown { present = false }
                })
            }
        }
        .onChange(of: shown) { _, now in
            let spec = HazelMotion.spec(tag, now ? .enter : .exit, part: part, sizeClass: sizeClass)
            if now { present = true }
            guard present else { return }
            if let spec { cue = MotionCue(spec: spec, id: (cue?.id ?? 0) + 1) } else if !now { present = false }
        }
    }
}
