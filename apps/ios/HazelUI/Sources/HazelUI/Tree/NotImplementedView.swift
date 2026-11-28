import os
import SwiftUI

/// What a tag whose view its lane has not written yet draws: a hairline box naming the tag and the
/// lane, logged once per tag. The web throws `NotImplemented` for the same case.
public struct NotImplementedView: View {
    let tag: String
    let lane: String

    private static let log = Logger(subsystem: "sh.hazel.ui", category: "primitives")
    @MainActor private static var logged: Set<String> = []
    /// Tags drawn as not implemented since the last `resetDrawn()`, with their lanes (the snapshot
    /// tests skip such a case and name its lanes).
    @MainActor public private(set) static var drawn: [String: String] = [:]
    @MainActor public static func resetDrawn() { drawn = [:] }

    public var body: some View {
        let _ = Self.note(tag, lane)
        Text("\(tag): lane \(lane)")
            .font(.caption.monospaced())
            .foregroundStyle(.secondary)
            .padding(4)
            .overlay(RoundedRectangle(cornerRadius: 4).strokeBorder(.secondary, style: StrokeStyle(lineWidth: 1, dash: [3])))
    }

    @MainActor private static func note(_ tag: String, _ lane: String) {
        drawn[tag] = lane
        guard logged.insert(tag).inserted else { return }
        log.error("\(tag, privacy: .public) is not implemented on iOS yet: lane \(lane, privacy: .public) owns it")
    }
}
