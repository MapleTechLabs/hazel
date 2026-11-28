import QuartzCore
import SwiftUI

/// Which reaction pieces move when a row draws again, as the web's `reactionPill` decides: a new pill
/// enters (`reactionIn`); a changed count rolls up or down, and its emoji pops when it rose.
enum ReactionMotion {
    struct Play: Equatable {
        let part: RowLayout.MotionPart
        let spec: HazelTheme.Motion.Spec
    }

    /// Nothing on a first draw (`old` nil) or under Reduce Motion, which finishes every motion at once.
    static func plan(_ tag: String, from old: [String: Int]?, to layout: RowLayout, reduceMotion: Bool) -> [Play] {
        guard let old, !reduceMotion else { return [] }
        var plays: [Play] = []
        for part in layout.motionParts {
            let before = old[part.key]
            let play: (HazelTheme.Motion.Trigger, String)? = switch part.role {
            case .reaction: before == nil ? (.enter, "reaction") : nil
            case .count: before.flatMap { $0 == part.count ? nil : (part.count > $0 ? .countUp : .countDown, "count") }
            case .emoji: before.flatMap { part.count > $0 ? (.pop, "emoji") : nil }
            }
            if let (trigger, name) = play, let spec = HazelMotion.spec(tag, trigger, part: name) {
                plays.append(Play(part: part, spec: spec))
            }
        }
        return plays
    }

    /// The items the moving pieces draw, left out of the row's base bitmap while they move.
    static func skipping(_ plays: [Play]) -> IndexSet {
        plays.reduce(into: IndexSet()) { $0.insert(integersIn: $1.part.items) }
    }

    /// How long until every piece rests.
    static func duration(_ plays: [Play]) -> Double {
        plays.compactMap { MotionTimeline($0.spec, reduceMotion: false) }.map { $0.delay + $0.duration }.max() ?? 0
    }

    /// The pieces as sublayers of a row's layer, each playing its motion; a count rolls inside a clip.
    @MainActor
    static func layers(_ plays: [Play], _ layout: RowLayout, scale: CGFloat) -> [CALayer] {
        plays.compactMap { play in
            guard let image = layout.drawPart(play.part, scale: scale),
                  let timeline = MotionTimeline(play.spec, reduceMotion: false) else { return nil }
            let rect = RowLayout.pixelRect(play.part.rect, scale: scale)
            let piece = CALayer()
            piece.contents = image
            piece.contentsScale = scale
            piece.frame = rect
            piece.add(timeline.layerAnimation(size: rect.size), forKey: "motion")
            guard play.part.role == .count else { return piece }
            let clip = CALayer()
            clip.frame = rect
            clip.masksToBounds = true
            piece.frame = CGRect(origin: .zero, size: rect.size)
            clip.addSublayer(piece)
            return clip
        }
    }
}

/// A leaf's row while its reaction pieces move: the base without them, each piece over it.
struct LeafMotion {
    struct Piece {
        let image: CGImage
        let rect: CGRect
        let spec: HazelTheme.Motion.Spec
        let clips: Bool
    }

    let id: Int
    let layout: RowLayout
    let base: CGImage
    let pieces: [Piece]

    init?(id: Int, layout: RowLayout, plays: [ReactionMotion.Play], scale: CGFloat) {
        guard !plays.isEmpty,
              let base = layout.draw(scale: scale, transparent: true, skipping: ReactionMotion.skipping(plays))
        else { return nil }
        self.id = id
        self.layout = layout
        self.base = base
        pieces = plays.compactMap { play in
            layout.drawPart(play.part, scale: scale).map {
                Piece(image: $0, rect: RowLayout.pixelRect(play.part.rect, scale: scale), spec: play.spec, clips: play.part.role == .count)
            }
        }
    }
}

/// Draws a `LeafMotion`. At rest the pieces sit exactly where the whole bitmap draws them.
struct LeafMotionView: View {
    let motion: LeafMotion
    let scale: CGFloat

    var body: some View {
        ZStack(alignment: .topLeading) {
            Image(decorative: motion.base, scale: scale)
            ForEach(Array(motion.pieces.enumerated()), id: \.offset) { _, piece in
                Image(decorative: piece.image, scale: scale)
                    .modifier(MotionModifier(cue: MotionCue(spec: piece.spec, id: motion.id)))
                    .frame(width: piece.rect.width, height: piece.rect.height)
                    .modifier(ClipIf(on: piece.clips))
                    .offset(x: piece.rect.minX, y: piece.rect.minY)
            }
        }
        .id(motion.id)
    }
}

private struct ClipIf: ViewModifier {
    let on: Bool
    func body(content: Content) -> some View {
        if on { content.clipped() } else { content }
    }
}
