import Foundation
import Observation
import QuartzCore

/// A semantic node (`web-foldkit/src/ui/semantic.ts`): an element the view marked with `data-ui`.
struct UiNode: Identifiable {
    let id: Int
    let kind: String
    let props: [String: Any]
    let children: [UiNode]

    var title: String { props["title"] as? String ?? "" }
    var symbol: String? { props["symbol"] as? String }
    var badge: Int { props["badge"] as? Int ?? 0 }
    var isSelected: Bool { props["isSelected"] as? Bool ?? false }
    var isEmphasized: Bool { props["isEmphasized"] as? Bool ?? false }
    var initials: String? { (props["avatar"] as? [String: Any])?["initials"] as? String }
}

/// The host's tree as the script last committed it (`effect-ui/native-host.ts` ops), and the
/// semantic screen read from it.
@Observable
@MainActor
final class EffectUiTree {
    private final class Element {
        let tag: String
        var attrs: [String: String] = [:]
        var children: [Int] = []
        var parent: Int?
        init(tag: String) { self.tag = tag }
    }

    private var elements: [Int: Element] = [0: Element(tag: "#container")]
    private(set) var screen: UiNode?

    /// What the last batches cost: shown on screen, so the numbers are in the screenshot.
    private(set) var batches = 0
    private(set) var lastOps = 0
    private(set) var lastBytes = 0
    private(set) var lastApplyMs = 0.0

    func apply(_ ops: [[Any]], bytes: Int) {
        let started = CACurrentMediaTime()
        for op in ops {
            guard let name = op.first as? String, let id = op[safe: 1] as? Int else { continue }
            switch name {
            case "element":
                elements[id] = Element(tag: op[safe: 2] as? String ?? "")
            case "text":
                elements[id] = Element(tag: "#text")
            case "attr":
                guard let element = elements[id], let key = op[safe: 2] as? String else { continue }
                element.attrs[key] = op[safe: 3] as? String
            case "insert":
                guard let parent = elements[id], let child = op[safe: 2] as? Int else { continue }
                detach(child)
                let before = op[safe: 3] as? Int
                let index = before.flatMap { parent.children.firstIndex(of: $0) } ?? parent.children.count
                parent.children.insert(child, at: index)
                elements[child]?.parent = id
            case "remove":
                detach(id)
                forget(id)
            default:
                continue
            }
        }
        screen = read(0).first
        batches += 1
        lastOps = ops.count
        lastBytes = bytes
        lastApplyMs = (CACurrentMediaTime() - started) * 1000
    }

    private func detach(_ id: Int) {
        guard let parent = elements[id]?.parent else { return }
        elements[parent]?.children.removeAll { $0 == id }
        elements[id]?.parent = nil
    }

    private func forget(_ id: Int) {
        guard let element = elements.removeValue(forKey: id) else { return }
        for child in element.children { forget(child) }
    }

    /// The semantic nodes at and under `id`: elements without `data-ui` are the web's drawing only.
    private func read(_ id: Int) -> [UiNode] {
        guard let element = elements[id] else { return [] }
        let below = element.children.flatMap(read)
        guard let kind = element.attrs["data-ui"] else { return below }
        let props = element.attrs["data-ui-props"]
            .flatMap { $0.data(using: .utf8) }
            .flatMap { try? JSONSerialization.jsonObject(with: $0) as? [String: Any] } ?? [:]
        return [UiNode(id: id, kind: kind, props: props, children: below)]
    }
}

private extension Array {
    subscript(safe index: Int) -> Element? { indices.contains(index) ? self[index] : nil }
}
