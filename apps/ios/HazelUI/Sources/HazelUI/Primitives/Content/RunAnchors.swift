import SwiftUI
import Synchronization

/// Where each run of a keyed leaf is on screen (`popover-anchor-run`): leaves publish, popovers read
/// `frame(key:run:)` (global coordinates). Text renderers draw off the main actor, so it is locked.
public final class RunAnchors: Sendable {
    public static let shared = RunAnchors()

    private struct Entry {
        var blocks: [Int: CGRect] = [:]
        var runs: [Int: (block: Int, rect: CGRect)] = [:]
    }

    private let state = Mutex<[String: Entry]>([:])

    /// The frame of run `run` of the leaf keyed `key`, nil until it has drawn.
    public func frame(key: String, run: Int) -> CGRect? {
        state.withLock { entries in
            guard let entry = entries[key], let hit = entry.runs[run], let block = entry.blocks[hit.block] else { return nil }
            return hit.rect.offsetBy(dx: block.minX, dy: block.minY)
        }
    }

    /// A block's text frame on screen (the origin its runs' rects are relative to).
    func setBlock(_ key: String, _ block: Int, _ frame: CGRect) {
        state.withLock { $0[key, default: Entry()].blocks[block] = frame }
    }

    /// Runs' rects inside their block, as one draw of that block measured them.
    func setRuns(_ key: String, _ runs: [Int: (block: Int, rect: CGRect)]) {
        state.withLock { entries in
            for (run, value) in runs { entries[key, default: Entry()].runs[run] = value }
        }
    }

    func clear(_ key: String) {
        _ = state.withLock { $0.removeValue(forKey: key) }
    }
}

/// Tags a rich text run with its number and block, so the renderer can publish its frame.
struct RunTag: TextAttribute {
    let run: Int
    let block: Int
}
