import SwiftUI

/// `hz:message` (lane S5): one chat row from its `row` data and its own flags, drawn by
/// `RowRenderer.message`, the same bitmap the list draws. Presses reach the row's targets. A row
/// turning `entering` rises in (`messageIn`), and its reactions move as they change.
struct HzMessage: View {
    let tree: Tree
    let node: Node

    var body: some View {
        if let row = HzMessage.row(node) {
            LeafView(tree: tree, node: node, fills: true, motionTag: "message") { RowRenderer.message(row, $0) }
                .modifier(MessageEnter(entering: row.flags.contains(.entering)))
        }
    }

    /// The node's row: its `row` prop (or `rowJson`), with `grouped` and the state flags.
    static func row(_ node: Node) -> RowData? {
        let grouped = node[prop: "grouped"]?.bool ?? false
        let flags = RowData.flags(node.props, events: node.events)
        if let json = node[prop: "rowJson"]?.string { return RowData(json: json, grouped: grouped, flags: flags) }
        return node[prop: "row"].flatMap { RowData(row: $0, grouped: grouped, flags: flags) }
    }
}

/// Plays the message's enter when it mounts entering or turns `entering`; turning it off does not
/// cut a play short, as the web's mark stays until its animation ends.
private struct MessageEnter: ViewModifier {
    let entering: Bool
    @State private var cue: MotionCue?

    init(entering: Bool) {
        self.entering = entering
        _cue = State(initialValue: entering ? HazelMotion.spec("message", .enter).map { MotionCue(spec: $0, id: 1) } : nil)
    }

    func body(content: Content) -> some View {
        content
            .modifier(MotionModifier(cue: cue))
            .onChange(of: entering) { was, now in
                guard now, !was, let spec = HazelMotion.spec("message", .enter) else { return }
                cue = MotionCue(spec: spec, id: (cue?.id ?? 0) + 1)
            }
    }
}
