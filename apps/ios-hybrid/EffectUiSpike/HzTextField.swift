import SwiftUI

/// The controlled text rule (G5), line for line `packages/ui/src/native/revisions.ts`: `rev` counts
/// this field's edits, `edit` the Model's; the field owns the text while editing.
struct TextFieldRevisions: Equatable {
    struct Incoming: Equatable { let text: String, rev: Int, edit: Int }
    struct Change { let value: String, rev: Int, edit: Int }

    private(set) var text = ""
    private(set) var rev = 0
    private(set) var edit = 0
    private var history: [Int: String] = [0: ""]

    /// A local edit: the next revision and the change to send; a no-op edit sends nothing.
    mutating func edit(_ next: String) -> Change? {
        guard next != text else { return nil }
        rev += 1
        text = next
        history[rev] = next
        return Change(value: next, rev: rev, edit: edit)
    }

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

    static func decode(_ value: JSONValue?) -> Incoming? {
        guard let object = value?.object, let text = object["text"]?.string,
              let rev = object["rev"]?.number, let edit = object["edit"]?.number
        else { return nil }
        return Incoming(text: text, rev: Int(rev), edit: Int(edit))
    }
}

struct TextFieldProps {
    let label: String, placeholder: String, error: String?, value: TextFieldRevisions.Incoming?
    init(_ p: [String: JSONValue]) {
        label = p["label"]?.string ?? ""
        placeholder = p["placeholder"]?.string ?? ""
        error = p["error"]?.string
        value = TextFieldRevisions.decode(p["value"])
    }
}

/// HAZEL-GAP: the spike `Theme` has no danger role yet; this is the `danger` token (red-600).
private let danger = Color(hex: "#e7000b")

/// `hz:textField`: a native `TextField` that owns its text; Model values apply by the rule above.
struct HzTextField: View {
    let node: HzNode
    let runtime: EffectUiRuntime
    @State private var field = TextFieldRevisions()
    @FocusState private var focused: Bool

    var body: some View {
        let props = TextFieldProps(node.props)
        VStack(alignment: .leading, spacing: 6) {
            Text(props.label).font(Theme.Section.font).foregroundStyle(Theme.Section.label)
            TextField(props.placeholder, text: Binding(get: { field.text }, set: { next in
                if let change = field.edit(next) { send("change", change) }
            }))
            .font(Theme.Row.font)
            .foregroundStyle(Theme.Row.labelEmphasized)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .submitLabel(.send)
            .focused($focused)
            // Submit keeps the keyboard up, so typing goes on into the cleared field.
            .onSubmit {
                send("submit", field.current)
                focused = true
            }
            .padding(.horizontal, 12)
            .frame(height: Theme.Row.height)
            .background(RoundedRectangle(cornerRadius: Theme.Row.radius).strokeBorder(
                props.error == nil ? Theme.bandBorder : danger, lineWidth: 1))
            .accessibilityLabel(props.label)
            .accessibilityIdentifier("hz-textField")
            if let error = props.error {
                Text(error).font(Inter.font(size: 12, weight: 400)).foregroundStyle(danger)
            }
        }
        .padding(.top, 8)
        .onChange(of: props.value, initial: true) { _, value in
            if let value, let change = field.receive(value) { send("change", change) }
        }
    }

    private func send(_ event: String, _ change: TextFieldRevisions.Change) {
        let payload: [String: Any] = ["value": change.value, "rev": change.rev, "edit": change.edit]
        guard let data = try? JSONSerialization.data(withJSONObject: payload),
              let json = String(data: data, encoding: .utf8) else { return }
        runtime.fire(node.id, event, payload: json)
    }
}
