import QuartzCore
import SwiftUI
import XCTest
@testable import HazelUI

/// The motion layer (`packages/ui/MOTION.md`): what plays comes from `HazelTheme.Motion`, an exit
/// holds its node until it ends, and Reduce Motion finishes at once.
@MainActor
final class MotionTests: XCTestCase {
    typealias M = HazelTheme.Motion

    override func tearDown() async throws {
        HazelMotion.enabled = false
        HazelMotion.reduceOverride = nil
    }

    // MARK: from the theme

    func testUsesComeFromTheRecipes() {
        XCTAssertEqual(HazelMotion.spec("dialog", .enter, part: "panel"), M.riseIn)
        XCTAssertEqual(HazelMotion.spec("dialog", .enter, part: "panel", sizeClass: .regular), M.scaleIn)
        XCTAssertEqual(HazelMotion.spec("dialog", .enter, part: "panel", backdrop: true), M.scrimIn)
        XCTAssertEqual(HazelMotion.spec("sheet", .enter, part: "panel"), M.slideUpIn)
        XCTAssertEqual(HazelMotion.spec("sheet", .enter, part: "panel", sizeClass: .regular), M.scaleIn)
        XCTAssertEqual(HazelMotion.spec("toast", .enter, part: "panel"), M.toastIn)
        XCTAssertEqual(HazelMotion.spec("toast", .exit, part: "panel"), M.toastOut)
        XCTAssertEqual(HazelMotion.spec("message", .enter), M.messageIn)
        XCTAssertEqual(HazelMotion.spec("reactionBar", .pop, part: "emoji"), M.reactionPop)
        XCTAssertEqual(HazelMotion.spec("item", .countDown, part: "count"), M.countDown)
        XCTAssertEqual(HazelMotion.spec("typingIndicator", .loop, part: "dot"), M.bounce)
        // Nothing the recipe does not declare plays: menus have no exit, items no enter.
        XCTAssertNil(HazelMotion.spec("menu", .exit, part: "panel"))
        XCTAssertNil(HazelMotion.spec("item", .enter))
    }

    func testTimelineDurationsAndCurvesAreTheSpecs() throws {
        let pop = try XCTUnwrap(MotionTimeline(M.reactionPop, reduceMotion: false))
        XCTAssertEqual(pop.steps.map(\.duration), [0.45 * M.reactionPop.duration, 0.55 * M.reactionPop.duration])
        XCTAssertEqual(pop.steps.map(\.curve), [M.reactionPop.curve, M.reactionPop.curve])
        XCTAssertEqual(pop.duration, M.reactionPop.duration, accuracy: 1e-9)
        XCTAssertEqual(pop.steps[0].pose.scale, 1.3)

        // A keyframe's own curve eases its segment (the bounce's fall, then rise).
        let bounce = try XCTUnwrap(MotionTimeline(M.bounce, reduceMotion: false))
        XCTAssertEqual(bounce.steps.map(\.curve), M.bounce.keyframes.dropLast().map { $0.curve ?? M.bounce.curve })
        XCTAssertTrue(bounce.repeats)

        // A frame halfway through the toast's enter is the theme curve's value there.
        let toast = try XCTUnwrap(MotionTimeline(M.toastIn, reduceMotion: false))
        let half = toast.frame(at: M.toastIn.duration / 2)
        let eased = M.toastIn.curve.value(at: 0.5)
        XCTAssertEqual(half.opacity, eased, accuracy: 1e-6)
        XCTAssertEqual(Double(half.yPoints), 8 * (1 - eased), accuracy: 1e-6)
        XCTAssertEqual(toast.frame(at: 10), MotionFrame.rest)

        // The delay holds the first pose (`both`), then the fade plays.
        let skeleton = try XCTUnwrap(MotionTimeline(M.skeletonIn, reduceMotion: false))
        XCTAssertEqual(skeleton.delay, M.skeletonIn.delay)
        XCTAssertEqual(skeleton.frame(at: M.skeletonIn.delay * 0.9).opacity, 0)
        XCTAssertEqual(skeleton.frame(at: M.skeletonIn.delay + M.skeletonIn.duration).opacity, 1)

        // A count rolls from 70% of its own height; a loop wraps to its first pose.
        XCTAssertEqual(MotionFrame(M.countUp.keyframes[0].pose).yFraction, 0.7)
        let sweep = try XCTUnwrap(MotionTimeline(M.progressSweep, reduceMotion: false))
        XCTAssertEqual(sweep.frame(at: M.progressSweep.duration * 3).xFraction, -1, accuracy: 1e-6)
    }

    func testCurveIsCSSCubicBezier() {
        XCTAssertEqual(M.Curve(0, 0, 1, 1).value(at: 0.3), 0.3, accuracy: 1e-6)
        // CSS `ease` at 50% is 0.8024.
        XCTAssertEqual(M.Curve(0.25, 0.1, 0.25, 1).value(at: 0.5), 0.8024, accuracy: 1e-3)
        // The overshoot curve passes 1 before it settles.
        XCTAssertGreaterThan(M.reactionIn.curve.value(at: 0.6), 1)
    }

    func testLayerAnimationIsTheTimeline() throws {
        let timeline = try XCTUnwrap(MotionTimeline(M.messageIn, reduceMotion: false))
        let group = try XCTUnwrap(timeline.layerAnimation(size: CGSize(width: 100, height: 40), flipped: true) as? CAAnimationGroup)
        XCTAssertEqual(group.duration, M.messageIn.duration, accuracy: 1e-9)
        let tracks = (group.animations ?? []).compactMap { $0 as? CAKeyframeAnimation }
        // Only what moves: scale stays out, so a flipped layer keeps its own transform.
        XCTAssertEqual(Set(tracks.compactMap(\.keyPath)), ["opacity", "transform.translation.y"])
        let rise = try XCTUnwrap(tracks.first { $0.keyPath == "transform.translation.y" })
        XCTAssertEqual(rise.values as? [CGFloat], [-6, 0])
        var points = [Float](repeating: 0, count: 2)
        rise.timingFunctions?.first?.getControlPoint(at: 1, values: &points)
        XCTAssertEqual(Double(points[0]), M.messageIn.curve.x1, accuracy: 1e-6)
        XCTAssertEqual(Double(points[1]), M.messageIn.curve.y1, accuracy: 1e-6)
    }

    // MARK: reactions

    func testReactionPlanMatchesTheWeb() throws {
        let c = RowContext(width: 360)
        func bar(_ reactions: [(String, Int)]) -> RowLayout {
            RowRenderer.reactionBar(reactions.map { RowData.Reaction(emoji: $0.0, count: $0.1, mine: false) }, addable: false, c)
        }
        let before = bar([("👍", 2), ("🎉", 1)])
        XCTAssertEqual(before.reactionCounts, ["👍": 2, "🎉": 1])

        let up = bar([("👍", 3), ("🎉", 1), ("❤️", 1)])
        let plays = ReactionMotion.plan("reactionBar", from: before.reactionCounts, to: up, reduceMotion: false)
        let named = Set(plays.map { "\($0.part.key) \($0.part.role) \($0.spec.name)" })
        XCTAssertEqual(named, ["❤️ reaction reactionIn", "👍 count countUp", "👍 emoji reactionPop"])
        XCTAssertFalse(ReactionMotion.skipping(plays).isEmpty)
        XCTAssertNotNil(up.drawPart(try XCTUnwrap(plays.first).part, scale: 3))

        let down = ReactionMotion.plan("reactionBar", from: up.reactionCounts, to: before, reduceMotion: false)
        XCTAssertEqual(down.map { "\($0.part.key) \($0.spec.name)" }, ["👍 countDown"])

        // A first draw, and Reduce Motion, move nothing.
        XCTAssertTrue(ReactionMotion.plan("reactionBar", from: nil, to: up, reduceMotion: false).isEmpty)
        XCTAssertTrue(ReactionMotion.plan("reactionBar", from: before.reactionCounts, to: up, reduceMotion: true).isEmpty)
    }

    // MARK: exit holds

    func testTreeHoldKeepsARemovedSubtreeUntilReleased() throws {
        let tree = Tree()
        try tree.apply(WireDecoder.decode(Fixture.batch(seq: 1, ops: [
            #"["create",1,"hz:stack"]"#, #"["create",2,"hz:toast"]"#, #"["create",3,"hz:text"]"#,
            #"["insert",2,3,null]"#, #"["insert",1,2,null]"#, #"["insert",0,1,null]"#,
        ])))
        tree.hold(2)
        // Removing an ancestor takes the held toast out of the tree, but it stays readable.
        try tree.apply(WireDecoder.decode(Fixture.batch(seq: 2, ops: [#"["remove",1]"#])))
        XCTAssertNil(tree.node(1))
        XCTAssertNotNil(tree.node(2))
        XCTAssertNotNil(tree.node(3))
        XCTAssertTrue(tree.isRetired(2))
        tree.release(2)
        XCTAssertNil(tree.node(2))
        XCTAssertNil(tree.node(3))
        // A hold released while the node is still in the tree changes nothing.
        try tree.apply(WireDecoder.decode(Fixture.batch(seq: 3, ops: [#"["create",4,"hz:toast"]"#, #"["insert",0,4,null]"#])))
        tree.hold(4)
        tree.release(4)
        XCTAssertNotNil(tree.node(4))
    }

    private func toastTree() throws -> (Tree, Node) {
        let tree = Tree()
        try tree.apply(WireDecoder.decode(Fixture.batch(seq: 1, ops: [
            #"["create",1,"hz:stack"]"#, #"["create",2,"hz:toast"]"#, #"["props",2,{"open":true,"title":"Saved"}]"#,
            #"["insert",1,2,null]"#, #"["insert",0,1,null]"#,
        ])))
        return (tree, try XCTUnwrap(tree.node(2)))
    }

    func testToastExitHoldsItsNodeUntilTheExitEnds() async throws {
        HazelMotion.enabled = true
        HazelMotion.reduceOverride = false
        let (tree, node) = try toastTree()
        let window = ToastWindow.shared
        window.show(tree, node)
        // The view removes the toast while it shows: its exit plays, the node is kept.
        try tree.apply(WireDecoder.decode(Fixture.batch(seq: 2, ops: [#"["remove",1]"#])))
        window.hide(tree, node.id)
        XCTAssertEqual(window.model.toasts.map(\.exiting), [true])
        XCTAssertNotNil(tree.node(node.id))
        try await Task.sleep(for: .seconds(M.toastOut.duration / 3))
        XCTAssertEqual(window.model.toasts.count, 1, "still exiting")
        try await Task.sleep(for: .seconds(M.toastOut.duration + 0.15))
        XCTAssertTrue(window.model.toasts.isEmpty, "gone once toastOut ended")
        XCTAssertNil(tree.node(node.id), "and its node freed")
    }

    func testToastReopenedWhileExitingStays() async throws {
        HazelMotion.enabled = true
        HazelMotion.reduceOverride = false
        let (tree, node) = try toastTree()
        let window = ToastWindow.shared
        window.show(tree, node)
        window.hide(tree, node.id)
        window.show(tree, node)
        XCTAssertEqual(window.model.toasts.map(\.exiting), [false])
        try await Task.sleep(for: .seconds(M.toastOut.duration + 0.15))
        XCTAssertEqual(window.model.toasts.count, 1, "the older exit does not take the reopened toast")
        HazelMotion.reduceOverride = true
        window.hide(tree, node.id)
        XCTAssertTrue(window.model.toasts.isEmpty)
    }

    // MARK: Reduce Motion

    func testReduceMotionFinishesAtOnceKeepsDelaysAndStopsLoops() throws {
        let enter = try XCTUnwrap(MotionTimeline(M.skeletonIn, reduceMotion: true))
        XCTAssertEqual(enter.duration, 0)
        XCTAssertEqual(enter.delay, M.skeletonIn.delay, "delays stay")
        XCTAssertEqual(enter.frame(at: M.skeletonIn.delay / 2).opacity, 0)
        XCTAssertEqual(enter.frame(at: M.skeletonIn.delay + 0.001), MotionFrame.rest)
        XCTAssertNil(MotionTimeline(M.progressSweep, reduceMotion: true), "a loop does not run")
        XCTAssertNil(MotionTimeline(M.bounce, reduceMotion: true))

        HazelMotion.reduceOverride = true
        XCTAssertNil(controlAnimation(0.15, reduceMotion: false), "press transitions finish at once")
        HazelMotion.reduceOverride = false
        XCTAssertNotNil(controlAnimation(0.15, reduceMotion: false))
    }

    func testReduceMotionRemovesAClosingToastAtOnce() throws {
        HazelMotion.enabled = true
        HazelMotion.reduceOverride = true
        let (tree, node) = try toastTree()
        ToastWindow.shared.show(tree, node)
        try tree.apply(WireDecoder.decode(Fixture.batch(seq: 2, ops: [#"["remove",1]"#])))
        ToastWindow.shared.hide(tree, node.id)
        XCTAssertTrue(ToastWindow.shared.model.toasts.isEmpty)
        XCTAssertNil(tree.node(node.id))
    }
}
