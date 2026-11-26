import Foundation
import Observation
import QuartzCore
import os
import HazelUI

/// A `hazel` node as the views read it: its `hz:*` tag, its props as they crossed the wire, and its
/// children. Typed views over the props are in `HazelViews.swift`.
struct HzNode: Identifiable {
    let id: Int
    let tag: String
    let props: [String: JSONValue]
    let text: String
    let events: Set<String>
    let children: [HzNode]

    /// The slot named `name` among the children (`hz:slot`, `.leading(...)`, `.fallback(...)`).
    func slot(_ name: String) -> HzNode? {
        children.first { $0.tag == "hz:slot" && $0.props["name"]?.string == name }
    }

    /// Children that are not slots: what a container lays out.
    var content: [HzNode] { children.filter { $0.tag != "hz:slot" } }

    /// The text of a text primitive: its text children joined.
    var joinedText: String { children.map { $0.tag == "#text" ? $0.text : $0.joinedText }.joined() }
}

/// The host's tree as the script last committed it (`packages/ui/src/native/host.ts` ops, wire v2).
@Observable
@MainActor
final class EffectUiTree {
    private final class Node {
        let tag: String
        var props: [String: JSONValue] = [:]
        var text = ""
        var events: Set<String> = []
        var children: [Int] = []
        var parent: Int?
        init(tag: String) { self.tag = tag }
    }

    private var nodes: [Int: Node] = [0: Node(tag: "#root")]
    private(set) var root: [HzNode] = []

    /// What the last batches cost: shown on screen, so the numbers are in the screenshot.
    private(set) var batches = 0
    private(set) var lastSeq = 0
    private(set) var lastOps = 0
    private(set) var lastBytes = 0
    private(set) var lastApplyMs = 0.0

    func apply(_ batch: Batch, bytes: Int) {
        let started = CACurrentMediaTime()
        if batch.seq != lastSeq + 1 {
            EffectUiRuntime.log.error("[tree] batch \(batch.seq) after \(self.lastSeq): out of order")
        }
        for op in batch.ops {
            switch op {
            case let .create(id, tag):
                nodes[id] = Node(tag: tag)
            case let .props(id, changed):
                guard let node = nodes[id] else { continue }
                for (name, value) in changed {
                    if value == .null { node.props[name] = nil } else { node.props[name] = value }
                }
            case let .text(id, text):
                nodes[id]?.text = text
            case let .insert(parentId, id, before):
                guard let parent = nodes[parentId] else { continue }
                detach(id)
                let index = before.flatMap { parent.children.firstIndex(of: $0) } ?? parent.children.count
                parent.children.insert(id, at: index)
                nodes[id]?.parent = parentId
            case let .remove(id):
                detach(id)
                forget(id)
            case let .events(id, names):
                nodes[id]?.events = Set(names)
            case .detach, .command:
                continue
            }
        }
        // G1 re-reads the tree per batch; per-node observation is G8.
        root = nodes[0]?.children.compactMap(read) ?? []
        batches += 1
        lastSeq = batch.seq
        lastOps = batch.ops.count
        lastBytes = bytes
        lastApplyMs = (CACurrentMediaTime() - started) * 1000
    }

    private func detach(_ id: Int) {
        guard let parent = nodes[id]?.parent else { return }
        nodes[parent]?.children.removeAll { $0 == id }
        nodes[id]?.parent = nil
    }

    private func forget(_ id: Int) {
        guard let node = nodes.removeValue(forKey: id) else { return }
        for child in node.children { forget(child) }
    }

    private func read(_ id: Int) -> HzNode? {
        guard let node = nodes[id] else { return nil }
        return HzNode(
            id: id, tag: node.tag, props: node.props, text: node.text, events: node.events,
            children: node.children.compactMap(read)
        )
    }
}
