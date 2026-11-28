import Observation
import SwiftUI
import UIKit

/// `hz:list` (lane S5): keyed rows in a scroll viewport. A list of chat rows (`message`, `listDivider`)
/// is G7's `MessageListView`: rows as data, drawn as bitmaps off the main thread, anchored on prepend,
/// sticking to the bottom. Any other rows are SwiftUI views in a lazy stack. Both draw the `overlay`
/// slot over the top edge, the `loading` skeleton, the edge spinners, and answer `scrollTo`.
struct HzList: View {
    let tree: Tree
    let node: Node

    var body: some View {
        let _ = RenderCounter.record(node.id)
        let recipe = HazelTheme.Recipes.list
        let rows = tree.content(of: node)
        let chat = !rows.isEmpty && rows.allSatisfy { $0.tag == "hz:message" || $0.tag == "hz:listDivider" }
        let loading = node[prop: "loading"]?.bool ?? false
        ZStack(alignment: .top) {
            if loading {
                ListSkeleton().accessibilityHidden(true)
            } else if chat {
                ChatList(tree: tree, node: node)
            } else {
                StackList(tree: tree, node: node)
            }
            if let overlay = tree.slot("overlay", of: node) {
                VStack(spacing: recipe.style(part: "overlay", sizeClass: .compact).gap ?? 0) {
                    ChildrenView(tree: tree, node: overlay)
                }
                .padding(.top, Token.space("2"))
            }
        }
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .contain)
        .accessibilityAddTraits(node[prop: "anchor"]?.string == "end" ? .updatesFrequently : [])
        .accessibilityLabel(loading ? "Loading" : "")
    }

    /// `scrollTo` targets: `{to: "start" | "end"}` or `{key}`, a row's wire key (`row-key`).
    enum Target {
        case edge(end: Bool)
        /// `selectText`: the row's text is selected too (a message menu's "Select Text").
        case row(key: String, selectText: Bool)

        init?(_ args: JSONValue) {
            if let to = args.object?["to"]?.string { self = .edge(end: to == "end") }
            else if let key = args.object?["key"]?.string {
                self = .row(key: key, selectText: args.object?["selectText"]?.bool == true)
            } else { return nil }
        }
    }

    /// A row's name for `scrollTo` and `move`: its key, or its position when it has none.
    static func key(_ row: Node, at index: Int) -> String { row[prop: "key"]?.string ?? String(index) }

    /// The position of the row named `key` among `rows`.
    static func index(of key: String, in rows: [Node]) -> Int? {
        rows.indices.first { Self.key(rows[$0], at: $0) == key }
    }
}

// MARK: - chat rows: the bitmap list

/// The chat list: `MessageListView` fed by a `ListSource` over this node, updated per changed row.
private struct ChatList: UIViewRepresentable {
    let tree: Tree
    let node: Node
    @Environment(\.colorScheme) private var scheme
    @Environment(\.horizontalSizeClass) private var sizeClass

    func makeCoordinator() -> ListBridge { ListBridge(tree: tree, node: node) }

    func makeUIView(context: Context) -> MessageListView {
        let view = MessageListView()
        context.coordinator.attach(view)
        return view
    }

    func updateUIView(_ view: MessageListView, context: Context) {
        view.dark = scheme == .dark
        view.sizeClass = HazelTheme.SizeClass(sizeClass)
        context.coordinator.apply(props: node.props)
    }

    /// Unbounded height (a snapshot, an unsized parent): every row's height; else the offer.
    func sizeThatFits(_ proposal: ProposedViewSize, uiView view: MessageListView, context: Context) -> CGSize? {
        let width = proposal.width.flatMap { $0.isFinite ? $0 : nil } ?? LeafLayout.fallbackWidth
        if let height = proposal.height, height.isFinite { return CGSize(width: width, height: height) }
        view.dark = scheme == .dark
        view.sizeClass = HazelTheme.SizeClass(sizeClass)
        return CGSize(width: width, height: view.contentHeight(width: width))
    }

    static func dismantleUIView(_ view: MessageListView, coordinator: ListBridge) { coordinator.detach() }
}

/// Keeps a `MessageListView` in step with the tree: watches the list's children and each row's props
/// (Observation), and hands the view only the rows that changed, once per run loop turn.
@MainActor
final class ListBridge {
    let tree: Tree
    let node: Node
    let source: ListSource
    private weak var view: MessageListView?
    private var pending: Set<NodeId> = []
    private var scheduled = false
    private var observed: Set<NodeId> = []
    private var commands: UUID?

    init(tree: Tree, node: Node) {
        self.tree = tree
        self.node = node
        source = ListSource(tree: tree, list: node)
    }

    func attach(_ view: MessageListView) {
        self.view = view
        view.onReachStart = { [weak self] in self?.fire("reachStart") }
        view.onReachEnd = { [weak self] in self?.fire("reachEnd") }
        view.onPress = { [weak self] key, layout, point in
            guard let self, let row = self.tree.node(key) else { return }
            LeafEvents.press(self.tree, row, layout, at: point)
        }
        view.onLongPress = { [weak self] key in
            guard let self, let row = self.tree.node(key), row.events.contains("longPress") else { return false }
            self.tree.fire(row.id, "longPress")
            return true
        }
        view.onAccessibilityEvent = { [weak self] key, event, payload in
            guard let self, self.tree.node(key) != nil else { return }
            self.tree.fire(key, event, payload)
        }
        commands = tree.setCommandHandler(node.id) { [weak self] name, args in
            guard let self, let view = self.view else { throw CommandError("list is gone") }
            guard name == .scrollTo, let target = HzList.Target(args) else { throw CommandError("hz:list does not handle \(name.rawValue)") }
            let animated = !UIAccessibility.isReduceMotionEnabled
            switch target {
            case let .edge(end): view.scroll(toEdge: end, animated: animated)
            case let .row(key, selectText):
                let rows = self.source.keys.map { self.tree.node($0) }
                guard let index = rows.indices.first(where: { i in rows[i].map { HzList.key($0, at: i) == key } ?? false })
                else { throw CommandError("hz:list has no row \(key)") }
                // "Select Text" comes from the row's own menu, so the row is on screen: no scroll.
                if selectText { view.selectText(self.source.keys[index]) } else { view.scroll(toRow: index, animated: animated) }
            }
            return .null
        }
        apply(props: node.props)
        watchChildren()
        reload(touched: [node.id])
    }

    func detach() {
        if let commands { tree.removeCommandHandler(node.id, token: commands) }
        view = nil
    }

    func apply(props: [String: JSONValue]) {
        guard let view else { return }
        view.anchorAtEnd = props["anchor"]?.string == "end"
        // The recipe's `content` padding: a chat insets its rows (`px-4`), as the web list does.
        let anchor = props["anchor"]?.string ?? "start"
        view.insetX = HazelTheme.Recipes.list.style(part: "content", options: ["anchor": anchor], sizeClass: view.sizeClass ?? .compact).paddingX ?? 0
        view.stickToBottom = props["stickToBottom"]?.bool ?? false
        view.loadingStart = props["loadingStart"]?.bool ?? false
        view.loadingEnd = props["loadingEnd"]?.bool ?? false
    }

    private func fire(_ event: String) {
        if tree.handles(node.id, event) { tree.fire(node.id, event) }
    }

    /// One-shot observation, renewed after each change: the children, then each row's props.
    private func watchChildren() {
        withObservationTracking { _ = node.children } onChange: { [weak self] in
            MainActor.assumeIsolated { self?.changed(self?.node.id) }
        }
    }

    private func watch(_ row: Node) {
        observed.insert(row.id)
        withObservationTracking { _ = row.props; _ = row.events } onChange: { [weak self] in
            MainActor.assumeIsolated { self?.changed(row.id) }
        }
    }

    /// Observation fires before the write lands: collect, and read once the batch is applied.
    private func changed(_ id: NodeId?) {
        guard let id else { return }
        pending.insert(id)
        if id != node.id { observed.remove(id) }
        guard !scheduled else { return }
        scheduled = true
        DispatchQueue.main.async { [weak self] in
            MainActor.assumeIsolated {
                guard let self else { return }
                self.scheduled = false
                let touched = self.pending
                self.pending = []
                if touched.contains(self.node.id) { self.watchChildren() }
                self.reload(touched: touched)
            }
        }
    }

    private func reload(touched: Set<NodeId>) {
        guard let dirty = source.refresh(touched: touched), let view else { return }
        for id in source.keys where id >= 0 && !observed.contains(id) {
            if let row = tree.node(id) { watch(row) }
        }
        view.set(keys: source.keys, entries: source.entries, dirty: dirty)
    }
}

// MARK: - other rows: a SwiftUI stack

/// Rows that are not chat rows (items, text): a lazy stack in a scroll view, anchored at the end for
/// `anchor: end`, with reach events, drag to reorder when `reorderable`, and `scrollTo`.
private struct StackList: View {
    let tree: Tree
    let node: Node
    @State private var position = ScrollPosition(edge: .top)
    @State private var nearStart = false
    @State private var nearEnd = false
    @State private var dragging: Int?
    @State private var commands: UUID?

    var body: some View {
        let recipe = HazelTheme.Recipes.list
        let content = recipe.style(part: "content", sizeClass: .compact)
        let end = node[prop: "anchor"]?.string == "end"
        let reorderable = node[prop: "reorderable"]?.bool ?? false
        let rows = tree.content(of: node)
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 0) {
                if node[prop: "loadingStart"]?.bool == true { ListSpinner() }
                ForEach(Array(rows.enumerated()), id: \.element.id) { index, row in
                    let view = NodeView(tree: tree, node: row).frame(maxWidth: .infinity, alignment: .leading).id(index)
                    let key = HzList.key(row, at: index)
                    if reorderable {
                        view
                            .opacity(dragging == index ? 0.5 : 1)
                            .draggable(key) { NodeView(tree: tree, node: row).onAppear { dragging = index } }
                            .dropDestination(for: String.self) { items, _ in
                                dragging = nil
                                guard let from = items.first, from != key else { return false }
                                tree.fire(node.id, "move", ["id": .string(from), "before": .string(key)])
                                return true
                            }
                    } else {
                        view
                    }
                }
                if node[prop: "loadingEnd"]?.bool == true { ListSpinner() }
            }
            .padding(.vertical, content.paddingY ?? 0)
        }
        .scrollPosition($position)
        .defaultScrollAnchor(end ? .bottom : .top)
        .onScrollGeometryChange(for: [Bool].self) { geo in
            let near = max(64, geo.containerSize.height / 2)
            let top = geo.contentOffset.y + geo.contentInsets.top
            let bottom = geo.contentSize.height - geo.containerSize.height - geo.contentOffset.y + geo.contentInsets.bottom
            return [top <= near, bottom <= near]
        } action: { _, now in
            if now[0], !nearStart, tree.handles(node.id, "reachStart"), node[prop: "loadingStart"]?.bool != true { tree.fire(node.id, "reachStart") }
            if now[1], !nearEnd, tree.handles(node.id, "reachEnd"), node[prop: "loadingEnd"]?.bool != true { tree.fire(node.id, "reachEnd") }
            nearStart = now[0]
            nearEnd = now[1]
        }
        .onAppear {
            commands = tree.setCommandHandler(node.id) { name, args in
                guard name == .scrollTo, let target = HzList.Target(args) else { throw CommandError("hz:list does not handle \(name.rawValue)") }
                let motion: Animation? = UIAccessibility.isReduceMotionEnabled ? nil : .easeOut(duration: HazelTheme.duration["normal"] ?? 0.2)
                withAnimation(motion) {
                    switch target {
                    case let .edge(end): position.scrollTo(edge: end ? .bottom : .top)
                    // A plain list has no native text selection: it only scrolls.
                    case let .row(key, _):
                        guard let index = HzList.index(of: key, in: tree.content(of: node)) else { return }
                        position.scrollTo(id: index)
                    }
                }
                return .null
            }
        }
        .onDisappear { if let commands { tree.removeCommandHandler(node.id, token: commands) } }
    }
}

/// The edge spinner (`loadingStart`, `loadingEnd`): three pulsing dots, centred.
private struct ListSpinner: View {
    @Environment(\.accessibilityReduceMotion) private var reduce
    var body: some View {
        let part = HazelTheme.Recipes.list.style(part: "loadingStart", sizeClass: .compact)
        let dot = Token.space("1.5")
        HStack(spacing: part.gap ?? 0) {
            ForEach(0..<3, id: \.self) { i in
                Circle().fill(HazelTheme.Colors.fg2.color).frame(width: dot, height: dot)
                    .modifier(Pulse(delay: Double(i) * 0.2, on: !reduce))
            }
        }
        .padding(.vertical, part.paddingY ?? 0)
        .frame(maxWidth: .infinity)
        .accessibilityElement()
        .accessibilityLabel("Loading")
    }
}

/// Skeleton rows while `loading` (renderer-owned, GAPS `skeleton`): an avatar and two lines each. The
/// block fades in after the recipe's delay (`skeletonIn`, so a fast load never shows it) and its shapes
/// pulse (`skeletonPulse`).
private struct ListSkeleton: View {
    var body: some View {
        let muted = HazelTheme.Colors.muted.color
        VStack(alignment: .leading, spacing: Token.space("5")) {
            ForEach(1...6, id: \.self) { n in
                HStack(alignment: .top, spacing: Token.space("3")) {
                    RoundedRectangle(cornerRadius: Token.radius("xl"), style: .continuous).fill(muted)
                        .frame(width: Token.space("9"), height: Token.space("9"))
                        .hzLoop("list", part: "skeletonAvatar")
                    GeometryReader { geo in
                        VStack(alignment: .leading, spacing: Token.space("2")) {
                            line(muted).frame(width: geo.size.width * 0.3)
                            // The web's `nth-child(3n + 2)` and `3n` widths for the second line.
                            line(muted).frame(width: geo.size.width * (n % 3 == 2 ? 0.4 : n % 3 == 0 ? 0.85 : 1))
                        }
                        .padding(.vertical, Token.space("1"))
                    }
                    .frame(height: Token.space("3") * 2 + Token.space("2") + Token.space("1") * 2)
                }
            }
        }
        .padding(Token.space("4"))
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .hzEnter("list", part: "skeleton", sizeClass: .compact)
    }

    private func line(_ color: Color) -> some View {
        RoundedRectangle(cornerRadius: Token.radius("sm")).fill(color).frame(height: Token.space("3"))
            .hzLoop("list", part: "skeletonLine")
    }
}

/// `hz-list-pulse`: half opacity at the middle of 1.4 s; it starts from rest, off under Reduce Motion.
/// Renderer-owned on the web too (`list.ts`), not a contract motion (GAPS `motion-renderer-loops`).
private struct Pulse: ViewModifier {
    let delay: Double
    let on: Bool
    @State private var dim = false

    func body(content: Content) -> some View {
        content
            .opacity(dim ? 0.5 : 1)
            .onAppear {
                guard on else { return }
                // A short hold before the first pulse, so the first frames (and snapshots) show rest.
                withAnimation(.easeInOut(duration: 0.7).repeatForever(autoreverses: true).delay(delay + 0.25)) { dim = true }
            }
    }
}
