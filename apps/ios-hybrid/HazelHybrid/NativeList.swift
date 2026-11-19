import SwiftUI
import UIKit

/// The message list, drawn natively over the web's (which stays laid out underneath, unseen).
///
/// Built for the frame budget: rows are bitmaps drawn once on a background queue from their display
/// lists, and scrolling only moves layers. The list is inverted (the newest row at the content's
/// origin), so heights that arrive for older rows extend the far end and never move what is on
/// screen. While it scrolls, it steers the web's list to lay out rows around what it shows.
final class NativeListView: UIView, UIScrollViewDelegate, UIContextMenuInteractionDelegate {
    private let scroll = UIScrollView()
    private weak var bridge: WebBridge?

    private var listId = ""
    private var count = 0
    /// The list holds the newest row (a list paged back from it keeps its place when newer come).
    private var followsEnd = true
    private var rows: [String: RowCapture] = [:]
    private var keyAt: [Int: String] = [:]
    /// Each known row's index in the web's window; shifted as a whole when the window grows or slides.
    private var indexOf: [String: Int] = [:]
    /// Heights by index, measured or estimated, and their sums from the newest row.
    private var heights: [CGFloat] = []
    private var sums: [CGFloat] = [0]
    private var estimate: CGFloat = 72

    private var layers: [String: CALayer] = [:]
    private var pool: [CALayer] = []
    private var images: [String: CGImage] = [:]
    private var rendering: Set<String> = []
    /// Rows whose bitmap on screen is from an older capture: drawn again, shown until then.
    private var stale: Set<String> = []
    private let queue = DispatchQueue(label: "sh.hazel.hybrid.rows", qos: .userInteractive)
    private var lastSteer: (index: Int, at: CFTimeInterval) = (-1, 0)
    /// Live pages for the rows' frames (HTML renders), which a bitmap cannot hold.
    private let frames = FramePool()
    private let frameLayer = PassThroughView()

    private static let flip = CGAffineTransform(scaleX: 1, y: -1)

    init(bridge: WebBridge) {
        self.bridge = bridge
        super.init(frame: .zero)
        backgroundColor = .clear
        scroll.delegate = self
        scroll.transform = Self.flip
        scroll.showsVerticalScrollIndicator = false
        scroll.alwaysBounceVertical = true
        scroll.contentInsetAdjustmentBehavior = .never
        // Dragging the list puts the keyboard away, as a chat's does.
        scroll.keyboardDismissMode = .onDrag
        addSubview(scroll)
        // The rows' live pages sit over the list, upright: a web view inside the flipped scroll
        // view works out its visible part wrong and paints nothing, or the wrong part.
        frameLayer.clipsToBounds = true
        addSubview(frameLayer)
        // A drag that starts on a page still scrolls the list (the pages never scroll themselves).
        addGestureRecognizer(scroll.panGestureRecognizer)
        scroll.addGestureRecognizer(UITapGestureRecognizer(target: self, action: #selector(tap(_:))))
        scroll.addInteraction(UIContextMenuInteraction(delegate: self))
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(keyboardWillChange(_:)),
            name: UIResponder.keyboardWillChangeFrameNotification,
            object: nil
        )
    }

    /// The composer floats over the list's bottom (its glass shows the rows under it): the last row
    /// sits clear of it. Set by the shell as the composer's height changes.
    var composerHeight: CGFloat = 0 {
        didSet { if abs(composerHeight - oldValue) > 0.5 { applyInset(animated: false) } }
    }
    /// The keyboard's height over the window's bottom edge (0 when it is down).
    private var keyboardHeight: CGFloat = 0

    /// Where the composer sits: this far above the keyboard, or this far into the home indicator's
    /// room when the keyboard is down (`ShellView` places it so).
    static let composerKeyboardGap: CGFloat = 8
    static let composerHomeDip: CGFloat = 14
    private static let rowGap: CGFloat = 8

    /// The rows' bottom inset: the composer, where it sits, and a little room above it.
    private var bottomInset: CGFloat {
        let below = keyboardHeight > 0
            ? keyboardHeight + Self.composerKeyboardGap
            : max(0, (window?.safeAreaInsets.bottom ?? 0) - Self.composerHomeDip)
        return composerHeight + below + Self.rowGap
    }

    override func didMoveToWindow() {
        super.didMoveToWindow()
        applyInset(animated: false)
    }

    /// The keyboard (the composer's) comes or goes: the list keeps its frame and moves its rows by
    /// the inset, on the keyboard's own curve, as the composer moves. Resizing the list would move
    /// it on SwiftUI's timing instead, a frame apart from the composer.
    @objc private func keyboardWillChange(_ notification: Notification) {
        guard let window, let info = notification.userInfo,
              let end = (info[UIResponder.keyboardFrameEndUserInfoKey] as? NSValue)?.cgRectValue
        else { return }
        keyboardHeight = max(0, window.bounds.maxY - end.minY)
        let duration = info[UIResponder.keyboardAnimationDurationUserInfoKey] as? Double ?? 0.25
        let curve = info[UIResponder.keyboardAnimationCurveUserInfoKey] as? UInt ?? 7
        applyInset(animated: true, duration: duration, curve: curve)
    }

    private func applyInset(animated: Bool, duration: Double = 0.25, curve: UInt = 7) {
        let inset = bottomInset
        // Inverted: the scroll view's top inset is the list's visual bottom.
        guard abs(scroll.contentInset.top - inset) > 0.5 else { return }
        let wasAtEnd = scroll.contentOffset.y <= -scroll.contentInset.top + 4
        let change = {
            self.scroll.contentInset.top = inset
            self.scroll.verticalScrollIndicatorInsets.top = inset
            if wasAtEnd { self.scroll.contentOffset.y = -inset }
        }
        if animated {
            UIView.animate(
                withDuration: duration,
                delay: 0,
                options: [UIView.AnimationOptions(rawValue: curve << 16), .beginFromCurrentState],
                animations: change
            )
        } else {
            change()
            showVisible()
        }
    }

    required init?(coder: NSCoder) { fatalError("init(coder:)") }

    override func layoutSubviews() {
        super.layoutSubviews()
        if scroll.frame != bounds {
            scroll.frame = bounds
            frameLayer.frame = bounds
            relayout()
        }
    }

    // MARK: Updates

    func apply(_ update: ListUpdate) {
        // What the reader looks at stays where it is through the update (the web's window grows,
        // slides or drops rows; heights arrive): the row nearest the bottom of the screen, by key.
        let anchor = anchorRow()
        if update.id != listId {
            listId = update.id
            rows = [:]
            keyAt = [:]
            indexOf = [:]
            images = [:]
            for layer in layers.values { recycle(layer) }
            layers = [:]
            // At the end: the newest row just above the composer (the inset is the list's bottom).
            scroll.contentOffset = CGPoint(x: 0, y: -scroll.contentInset.top)
        }
        count = update.count
        followsEnd = update.followsEnd
        // Where every row is now, when the window grew or slid: rows it no longer holds are gone.
        if let order = update.order {
            var placed: [String: Int] = [:]
            for (index, key) in order.enumerated() { placed[key] = index }
            for key in indexOf.keys where placed[key] == nil {
                rows[key] = nil
                images[key] = nil
                stale.remove(key)
            }
            indexOf = placed
        }
        for row in update.rows {
            // A row drawn before keeps its bitmap on screen until the new one is ready (no blank
            // frame); one that changed height starts over.
            if let old = rows[row.key] {
                if old.h == row.h, layers[row.key] != nil { stale.insert(row.key) } else { images[row.key] = nil }
            }
            rows[row.key] = row
            indexOf[row.key] = row.index
        }
        for (key, index) in indexOf where index < 0 || index >= count {
            indexOf[key] = nil
            rows[key] = nil
            images[key] = nil
        }
        keyAt = [:]
        for (key, index) in indexOf { keyAt[index] = key }
        for row in update.rows { keyAt[row.index] = row.key }
        let measured = rows.values.map(\.h)
        if !measured.isEmpty { estimate = measured.reduce(0, +) / CGFloat(measured.count) }
        relayout()
        restore(anchor)
    }

    /// The row at the bottom of the screen and how far it starts from there; `nil` while the list
    /// shows its newest row (it follows the end then).
    private func anchorRow() -> (key: String, offset: CGFloat)? {
        let offset = scroll.contentOffset.y
        guard offset > 1 || !followsEnd, let range = indexes(from: offset, to: offset + 1) else { return nil }
        let index = range.upperBound
        guard let key = keyAt[index] else { return nil }
        return (key, origin(of: index) - offset)
    }

    /// Back to the anchor, in the same layout pass (no frame shows the rows moved).
    private func restore(_ anchor: (key: String, offset: CGFloat)?) {
        guard let anchor, let index = indexOf[anchor.key], index < count, keyAt[index] == anchor.key else { return }
        let target = origin(of: index) - anchor.offset
        if abs(target - scroll.contentOffset.y) > 0.5 {
            scroll.contentOffset.y = target
            showVisible()
        }
    }

    /// Heights and sums from the newest row; content size; the rows on screen.
    private func relayout() {
        heights = (0..<count).map { index in keyAt[index].flatMap { rows[$0]?.h } ?? estimate }
        sums = [0]
        sums.reserveCapacity(count + 1)
        // sums[n] is the height of the n newest rows: row `count - 1 - n` starts there.
        for index in stride(from: count - 1, through: 0, by: -1) { sums.append((sums.last ?? 0) + heights[index]) }
        let width = bounds.width
        scroll.contentSize = CGSize(width: width, height: max(sums.last ?? 0, bounds.height))
        showVisible()
    }

    /// The content offset (from the newest row) where row `index` starts.
    private func origin(of index: Int) -> CGFloat { sums[count - 1 - index] }

    /// The rows between two content offsets, newest first.
    private func indexes(from low: CGFloat, to high: CGFloat) -> ClosedRange<Int>? {
        guard count > 0 else { return nil }
        // The n-th newest row covers sums[n] ..< sums[n + 1]; a binary search, every frame.
        let first = max(0, firstSum(after: low) - 1)
        let last = min(count - 1, max(first, firstSum(atLeast: high) - 1))
        return (count - 1 - last)...(count - 1 - first)
    }

    private func firstSum(after value: CGFloat) -> Int { search { $0 > value } }
    private func firstSum(atLeast value: CGFloat) -> Int { search { $0 >= value } }

    /// The first index of `sums` (ascending) where `test` holds, or `sums.count`.
    private func search(_ test: (CGFloat) -> Bool) -> Int {
        var low = 0
        var high = sums.count
        while low < high {
            let middle = (low + high) / 2
            if test(sums[middle]) { high = middle } else { low = middle + 1 }
        }
        return low
    }

    private func showVisible() {
        let low = scroll.contentOffset.y
        let high = low + bounds.height
        guard let visible = indexes(from: low, to: high),
              let ahead = indexes(from: low - bounds.height * 1.5, to: high + bounds.height * 1.5)
        else { return }
        var wanted = Set<String>()
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        for index in ahead {
            // A row the page lays out at no height (nothing to show) takes no room and no layer.
            guard let key = keyAt[index], let row = rows[key], row.h > 0 else { continue }
            wanted.insert(key)
            let layer = layers[key] ?? take()
            layers[key] = layer
            layer.bounds = CGRect(x: 0, y: 0, width: row.w, height: row.h)
            layer.position = CGPoint(x: row.x + row.w / 2, y: origin(of: index) + row.h / 2)
            if let image = images[key] {
                if (layer.contents as AnyObject?) !== image { layer.contents = image }
                if stale.remove(key) != nil { draw(row) }
            } else {
                layer.contents = nil
                draw(row)
            }
        }
        placeFrames(in: ahead)
        for (key, layer) in layers where !wanted.contains(key) {
            recycle(layer)
            layers[key] = nil
        }
        CATransaction.commit()
        // Rows on screen the web has not laid out yet: steer it there. Near the oldest row it holds,
        // steer it to its top, where it loads older messages.
        let missing = visible.contains { keyAt[$0] == nil } || ahead.contains { keyAt[$0] == nil }
        if ahead.lowerBound <= 2 { steer(toward: 0) }
        // At the newest row: the web list stays at its end, where it follows new messages.
        else if scroll.contentOffset.y < 4 { steer(toward: count - 1) }
        else if missing { steer(toward: visible.lowerBound + (visible.upperBound - visible.lowerBound) / 2) }
    }

    /// A picture rows draw arrived: rows on screen draw again (their old bitmap stays up until the
    /// new one is ready); the rest draw when they next show.
    /// Icons the page rasterized after rows that show them were drawn: those rows draw again.
    func iconsArrived(_ keys: Set<String>) {
        for (key, row) in rows where row.iconKeys.contains(where: keys.contains) {
            if layers[key] != nil { draw(row) } else { images[key] = nil }
        }
    }

    func pictureLoaded(_ src: String) {
        for (key, row) in rows where row.pictures.contains(where: { $0.src == src }) {
            if layers[key] != nil { draw(row) } else { images[key] = nil }
        }
    }

    /// Each framed page of the rows in `range` goes live over its row, where the web lays it out;
    /// the rest are put away.
    private func placeFrames(in range: ClosedRange<Int>) {
        var shown = Set<String>()
        for index in range {
            guard let key = keyAt[index], let row = rows[key] else { continue }
            for frame in row.frames {
                let view = frames.view(for: frame.src)
                if view.superview !== frameLayer { frameLayer.addSubview(view) }
                view.isHidden = false
                // Where the frame is in the (flipped) content: a row's top is at its origin plus
                // its height. Converted, it is where it shows.
                let content = CGRect(
                    x: row.x + frame.rect.minX,
                    y: origin(of: index) + row.h - frame.rect.maxY,
                    width: frame.rect.width,
                    height: frame.rect.height
                )
                view.frame = scroll.convert(content, to: frameLayer)
                view.layer.cornerRadius = frame.radius
                shown.insert(frame.src)
            }
        }
        frames.hideAll(except: shown)
    }

    private func take() -> CALayer {
        if let layer = pool.popLast() {
            layer.isHidden = false
            return layer
        }
        let layer = CALayer()
        layer.setAffineTransform(Self.flip)
        layer.contentsScale = window?.screen.scale ?? 3
        layer.contentsGravity = .resize
        scroll.layer.addSublayer(layer)
        return layer
    }

    private func recycle(_ layer: CALayer) {
        layer.isHidden = true
        layer.contents = nil
        pool.append(layer)
    }

    private func draw(_ row: RowCapture) {
        guard !rendering.contains(row.key), let bridge else { return }
        rendering.insert(row.key)
        let icons = bridge.icons
        let images = bridge.listImages
        let scale = window?.screen.scale ?? 3
        queue.async { [weak self] in
            let image = RowRenderer.render(row, icons: icons, images: images, scale: scale)
            DispatchQueue.main.async {
                guard let self else { return }
                self.rendering.remove(row.key)
                guard self.rows[row.key]?.h == row.h, let image else { return }
                self.images[row.key] = image
                if let layer = self.layers[row.key] { layer.contents = image }
                // A picture arrived while this drew without it: draw again with it.
                let lateIcons = row.iconKeys.contains { icons[$0] == nil && self.bridge?.icons[$0] != nil }
                let latePictures = row.pictures.contains {
                    images[$0.src] == nil && self.bridge?.listImages[$0.src] != nil
                }
                if lateIcons || latePictures { self.draw(row) }
                // Keep the bitmap cache bounded: drop what is far from the screen.
                if self.images.count > 400 {
                    for key in self.images.keys where self.layers[key] == nil { self.images[key] = nil }
                }
            }
        }
    }

    private func steer(toward index: Int) {
        let now = CACurrentMediaTime()
        guard abs(index - lastSteer.index) > 3 || now - lastSteer.at > 0.25 else { return }
        lastSteer = (index, now)
        bridge?.steerList(to: index)
    }

    func scrollViewDidScroll(_ scrollView: UIScrollView) { showVisible() }

    // MARK: Touch

    /// The row at a point of the scroll view, and the point in it (its own, unflipped).
    private func row(at point: CGPoint) -> (RowCapture, CGPoint)? {
        guard let range = indexes(from: point.y, to: point.y + 0.5) else { return nil }
        let index = range.upperBound
        guard let key = keyAt[index], let row = rows[key] else { return nil }
        let local = CGPoint(x: point.x - row.x, y: row.h - (point.y - origin(of: index)))
        return (row, local)
    }

    @objc private func tap(_ recognizer: UITapGestureRecognizer) {
        // A tap on the list puts the keyboard away; a tap on a link or button also presses it.
        window?.endEditing(true)
        guard let (row, point) = row(at: recognizer.location(in: scroll)),
              let hit = row.hits.last(where: { CGRect(x: $0.x, y: $0.y, width: $0.w, height: $0.h).contains(point) })
        else { return }
        UISelectionFeedbackGenerator().selectionChanged()
        bridge?.pressListHit(hit.id)
    }

    func contextMenuInteraction(
        _ interaction: UIContextMenuInteraction,
        configurationForMenuAtLocation location: CGPoint
    ) -> UIContextMenuConfiguration? {
        guard let (row, _) = row(at: location), let menu = row.menu else { return nil }
        let entries = MenuEntry.parse(menu.props["items"])
        let quick = menu.props["quick"]
        return UIContextMenuConfiguration(identifier: row.key as NSString, previewProvider: nil) { [weak self] _ in
            var children: [UIMenuElement] = []
            if case let .array(choices)? = quick?["choices"], let prefix = quick?["prefix"]?.string {
                let reactions = choices.compactMap(\.string).map { emoji in
                    UIAction(title: emoji) { _ in self?.bridge?.chooseListMenu(menu.id, key: prefix + emoji) }
                }
                children.append(UIMenu(options: .displayInline, preferredElementSize: .small, children: reactions))
            }
            children.append(contentsOf: Self.menuElements(entries, icons: self?.bridge?.icons ?? [:]) { key in self?.bridge?.chooseListMenu(menu.id, key: key) })
            return UIMenu(children: children)
        }
    }

    func contextMenuInteraction(
        _ interaction: UIContextMenuInteraction,
        configuration: UIContextMenuConfiguration,
        highlightPreviewForItemWithIdentifier identifier: any NSCopying
    ) -> UITargetedPreview? {
        guard let key = identifier as? String, let layer = layers[key], let image = images[key] else { return nil }
        // The row as drawn, lifted from where it is.
        let view = UIImageView(image: UIImage(cgImage: image, scale: layer.contentsScale, orientation: .downMirrored))
        view.frame = layer.frame
        scroll.addSubview(view)
        let parameters = UIPreviewParameters()
        parameters.backgroundColor = .clear
        return UITargetedPreview(view: view, parameters: parameters)
    }

    func contextMenuInteraction(
        _ interaction: UIContextMenuInteraction,
        willEndFor configuration: UIContextMenuConfiguration,
        animator: (any UIContextMenuInteractionAnimating)?
    ) {
        animator?.addCompletion { [weak self] in
            self?.scroll.subviews.filter { $0 is UIImageView }.forEach { $0.removeFromSuperview() }
        }
    }

    private static func menuElements(
        _ entries: [MenuEntry],
        icons: [String: UIImage],
        choose: @escaping (String) -> Void
    ) -> [UIMenuElement] {
        var groups: [[UIMenuElement]] = [[]]
        for entry in entries {
            switch entry.kind {
            case .separator:
                groups.append([])
            case let .submenu(children):
                groups[groups.count - 1].append(
                    UIMenu(title: entry.label, children: menuElements(children, icons: icons, choose: choose))
                )
            case let .item(key, isDestructive, isChecked):
                let action = UIAction(
                    title: entry.label,
                    // The web item's own icon; its SF Symbol only until the page has drawn it.
                    image: entry.image.flatMap { icons[$0]?.withRenderingMode(.alwaysTemplate) }
                        ?? entry.symbol.flatMap { UIImage(systemName: $0) },
                    attributes: isDestructive ? .destructive : [],
                    state: isChecked ? .on : .off
                ) { _ in choose(key) }
                groups[groups.count - 1].append(action)
            }
        }
        return groups.filter { !$0.isEmpty }.map { UIMenu(options: .displayInline, children: $0) }
    }
}

/// The native list where the web's list is, in the page's coordinates.
struct NativeListHost: UIViewRepresentable {
    let bridge: WebBridge
    /// The composer's height: the rows keep clear of it (it floats over them).
    var composerHeight: CGFloat = 0

    func makeUIView(context: Context) -> NativeListView {
        let view = NativeListView(bridge: bridge)
        bridge.listSink = { [weak view] update in
            guard let view else { return false }
            view.apply(update)
            return true
        }
        bridge.pictures.onLoad = { [weak view] src in view?.pictureLoaded(src) }
        bridge.iconsArrived = { [weak view] keys in view?.iconsArrived(keys) }
        return view
    }

    func updateUIView(_ view: NativeListView, context: Context) {
        view.composerHeight = composerHeight
    }
}

/// A view that takes no touches itself; its subviews (the rows' live pages) do.
final class PassThroughView: UIView {
    override func hitTest(_ point: CGPoint, with event: UIEvent?) -> UIView? {
        let hit = super.hitTest(point, with: event)
        return hit === self ? nil : hit
    }
}
