import Observation
import SwiftUI

// Owned by lane S2. The controlled text rule (G5), line for line `packages/ui/src/native/revisions.ts`:
// `rev` counts this field's edits, `edit` the Model's; the field owns the text while editing.

struct TextRevisions: Equatable {
    struct Incoming: Equatable { let text: String, rev: Int, edit: Int }
    struct Change: Equatable { let value: String, rev: Int, edit: Int }

    private(set) var text = ""
    private(set) var rev = 0
    private(set) var edit = 0
    /// Local revisions the Model may still answer: `history[rev]` is the text at that revision.
    private var history: [Int: String] = [0: ""]

    /// A local edit: the next revision and the change to send; a no-op edit sends nothing.
    mutating func edit(_ next: String) -> Change? {
        guard next != text else { return nil }
        rev += 1
        text = next
        history[rev] = next
        return Change(value: next, rev: rev, edit: edit)
    }

    /// What `submit` sends: the text at the current revision.
    var current: Change { Change(value: text, rev: rev, edit: edit) }

    /// A `value` from the Model: applied, ignored as stale, or rebased (then sent as a change).
    mutating func receive(_ incoming: Incoming) -> Change? {
        let (r, m) = (incoming.rev, incoming.edit)
        if m < edit || (m == edit && r < rev) { return nil }
        if r >= rev {
            (text, rev, edit, history) = (incoming.text, r, m, [r: incoming.text])
            return nil
        }
        // A Model edit against revision `r` while the user typed on: keep what was appended since.
        history = history.filter { $0.key >= r }
        if let base = history[r], text.hasPrefix(base) {
            text = incoming.text + text.dropFirst(base.count)
        }
        rev += 1
        edit = m
        history[rev] = text
        return Change(value: text, rev: rev, edit: edit)
    }

    /// A wire `value` prop: `{text, rev, edit}`, or nothing usable.
    static func decode(_ value: JSONValue?) -> Incoming? {
        guard let object = value?.object, let text = object["text"]?.string,
              let rev = object["rev"]?.number, let edit = object["edit"]?.number
        else { return nil }
        return Incoming(text: text, rev: Int(rev), edit: Int(edit))
    }
}

extension TextRevisions.Change {
    /// The `change` and `submit` payload (`TextField.ChangePayload`).
    var payload: JSONValue { ["value": .string(value), "rev": .number(Double(rev)), "edit": .number(Double(edit))] }
}

/// One text control's state, shared by textField, textArea, searchField and composer: the revision
/// pair, the selection, and where its changes go. Each edit and rebase fires `change` on the node.
@MainActor
@Observable
final class RevisionedText {
    private(set) var revisions = TextRevisions()
    var selection: TextSelection?
    @ObservationIgnored private var tree: Tree?
    @ObservationIgnored private var id: NodeId = -1

    var text: String { revisions.text }

    /// Where `change` goes; the view calls it before anything can fire.
    func attach(_ tree: Tree, _ node: Node) {
        self.tree = tree
        id = node.id
        #if DEBUG
        Self.live[node.id] = Weak(value: self)
        #endif
    }

    #if DEBUG
    /// The live control per node, for the stress test to type through the view's own binding path.
    struct Weak { weak var value: RevisionedText? }
    static var live: [NodeId: Weak] = [:]
    #endif

    /// The control's text binding: every write is a local edit.
    var binding: Binding<String> {
        Binding(get: { self.revisions.text }, set: { self.type($0) })
    }

    func type(_ next: String) {
        if let change = revisions.edit(next) { fire("change", change) }
    }

    /// A `value` prop from the Model, by the revision rule.
    func receive(_ value: JSONValue?) {
        guard let incoming = TextRevisions.decode(value) else { return }
        if let change = revisions.receive(incoming) { fire("change", change) }
    }

    func submit() { fire("submit", revisions.current) }

    /// `select {start, end}` in UTF-16 offsets (the web's `setSelectionRange`), clamped to the text.
    func select(_ args: JSONValue) {
        let units = text.utf16
        func index(_ key: String) -> String.Index {
            let offset = min(max(0, Int(args.object?[key]?.number ?? 0)), units.count)
            return String.Index(utf16Offset: offset, in: text)
        }
        let start = index("start"), end = max(start, index("end"))
        selection = TextSelection(range: start ..< end)
    }

    /// The caret's UTF-16 offset, or the end when there is no single caret known.
    var caret: Int? {
        guard let selection else { return text.utf16.count }
        guard case let .selection(range) = selection.indices, range.isEmpty else { return nil }
        return range.lowerBound.utf16Offset(in: text)
    }

    private func fire(_ event: String, _ change: TextRevisions.Change) {
        tree?.fire(id, event, change.payload)
    }
}

extension View {
    /// What every text control does with its node: take `value` by the revision rule, report focus
    /// and blur when the view handles them, and answer `focus`, `blur` and (when `select`) `select`.
    func hzTextControl(
        _ tree: Tree, _ node: Node, _ input: RevisionedText, focused: FocusState<Bool>.Binding, select: Bool = true
    ) -> some View {
        onAppear { input.attach(tree, node) }
            .onChange(of: node.props["value"], initial: true) { _, value in
                input.attach(tree, node)
                input.receive(value)
            }
            .onChange(of: focused.wrappedValue) { _, now in
                let event = now ? "focus" : "blur"
                if tree.handles(node.id, event) { tree.fire(node.id, event) }
            }
            .hazelCommands(tree, node) { name, args in
                switch name {
                case .focus: focused.wrappedValue = true
                case .blur: focused.wrappedValue = false
                case .select where select:
                    input.select(args)
                    focused.wrappedValue = true
                default: throw CommandError("\(node.tag) does not handle \(name.rawValue)")
                }
                return nil
            }
    }
}
