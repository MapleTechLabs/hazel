import SwiftUI
import UIKit

/// A chat leaf drawn outside the list (`message`, `listDivider`, `reactionBar`, `attachmentGrid`,
/// `embed`): the same `RowLayout` the list draws, as one image, so a row looks the same in both. Presses
/// go to the layout's targets; each target is also an accessibility element.
struct LeafView: View {
    let tree: Tree
    let node: Node
    /// Takes the offered width (rows) rather than its content's (pills, cards).
    let fills: Bool
    let make: (RowContext) -> RowLayout

    @Environment(\.colorScheme) private var scheme
    @Environment(\.displayScale) private var scale
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var box = LeafBox()

    var body: some View {
        let _ = RenderCounter.record(node.id)
        let base = RowContext(width: 0, sizeClass: HazelTheme.SizeClass(sizeClass), dark: scheme == .dark, scale: scale)
        let _ = box.update(base: base, props: node.props, events: node.events, make: make)
        LeafLayout(box: box, fills: fills) {
            GeometryReader { geo in
                if let (layout, image) = box.drawn(width: geo.size.width) {
                    Image(decorative: image, scale: base.scale)
                        .accessibilityHidden(true)
                        .accessibilityChildren { LeafAccessibility(tree: tree, node: node, layout: layout) }
                }
            }
        }
        .contentShape(Rectangle())
        .onTapGesture(coordinateSpace: .local) { point in
            guard let layout = box.last else { return }
            LeafEvents.press(tree, node, layout, at: point)
        }
        .onLongPressGesture(minimumDuration: 0.4) {
            if node.events.contains("longPress") { tree.fire(node.id, "longPress") }
        }
        .accessibilityElement(children: .contain)
    }
}

/// Dispatch shared by the leaf view and the list: the front-most target whose event the node handles.
@MainActor
enum LeafEvents {
    @discardableResult
    static func press(_ tree: Tree, _ node: Node, _ layout: RowLayout, at point: CGPoint) -> Bool {
        for target in layout.targets.reversed() where target.rect.insetBy(dx: -2, dy: -2).contains(point) {
            if tree.handles(node.id, target.event) {
                tree.fire(node.id, target.event, target.payload)
                return true
            }
        }
        return false
    }
}

/// The layout and its bitmap per width, kept while the node's props and the appearance stay the same.
/// Used on the main thread only (views and `Layout` calls), which SwiftUI does not state for `Layout`.
final class LeafBox: @unchecked Sendable {
    private var base: RowContext?
    private var props: [String: JSONValue] = [:]
    private var events: Set<String> = []
    private var make: ((RowContext) -> RowLayout)?
    private var layouts: [CGFloat: RowLayout] = [:]
    private var images: [CGFloat: CGImage] = [:]
    private(set) var last: RowLayout?

    func update(base: RowContext, props: [String: JSONValue], events: Set<String>, make: @escaping (RowContext) -> RowLayout) {
        self.make = make
        guard base != self.base || props != self.props || events != self.events else { return }
        self.base = base
        self.props = props
        self.events = events
        layouts = [:]
        images = [:]
    }

    func layout(width: CGFloat) -> RowLayout? {
        guard var context = base, let make, width > 0 else { return nil }
        if let hit = layouts[width] { return hit }
        context.width = width
        let made = make(context)
        layouts[width] = made
        return made
    }

    func drawn(width: CGFloat) -> (RowLayout, CGImage)? {
        guard let layout = layout(width: width) else { return nil }
        last = layout
        if let image = images[width] { return (layout, image) }
        guard let image = layout.draw(scale: base?.scale ?? 2, transparent: true) else { return nil }
        images[width] = image
        return (layout, image)
    }
}

/// Sizes a leaf: rows take the offered width, pills and cards their content's (at most the offer).
struct LeafLayout: Layout {
    let box: LeafBox
    let fills: Bool
    /// The width a leaf lays out at when nothing is offered (a filling row in an unsized parent).
    static let fallbackWidth: CGFloat = 402
    static let unbounded: CGFloat = 100_000

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let offered = proposal.width.flatMap { $0.isFinite ? $0 : nil }
        if fills {
            let width = offered ?? Self.fallbackWidth
            return CGSize(width: width, height: box.layout(width: width)?.height ?? 0)
        }
        guard let natural = box.layout(width: offered ?? Self.unbounded) else { return .zero }
        // Laid out again at its own width, so a card or bar draws exactly as wide as it measured.
        let width = max(1, natural.usedWidth)
        return CGSize(width: width, height: box.layout(width: width)?.height ?? natural.height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        subviews.first?.place(at: bounds.origin, proposal: ProposedViewSize(bounds.size))
    }
}

/// A leaf's accessibility: the whole row, then each pressable span at its place.
struct LeafAccessibility: View {
    let tree: Tree
    let node: Node
    let layout: RowLayout

    var body: some View {
        ZStack(alignment: .topLeading) {
            Rectangle().fill(.clear)
                .frame(width: layout.width, height: layout.height)
                .accessibilityElement()
                .accessibilityLabel(layout.label)
                .accessibilityActions {
                    ForEach(Array(layout.actions.enumerated()), id: \.offset) { _, action in
                        Button(action.label) { tree.fire(node.id, action.event, action.payload) }
                    }
                }
            ForEach(Array(layout.targets.enumerated()), id: \.offset) { _, target in
                if target.event != "press" || layout.targets.count == 1 {
                    Rectangle().fill(.clear)
                        .frame(width: target.rect.width, height: target.rect.height)
                        .offset(x: target.rect.minX, y: target.rect.minY)
                        .accessibilityElement()
                        .accessibilityLabel(target.label)
                        .accessibilityAddTraits(target.role == .link ? .isLink : target.role == .image ? .isImage : .isButton)
                        .accessibilityAddTraits(target.selected ? .isSelected : [])
                        .accessibilityAction { tree.fire(node.id, target.event, target.payload) }
                }
            }
        }
        .frame(width: layout.width, height: layout.height, alignment: .topLeading)
    }
}
