import UIKit

/// The native message list (G7): bottom-anchored, lazy, built for the frame budget.
///
/// Inverted (the newest entry at the content's origin), so older pages extend the far end and never
/// move what is on screen. Heights come from `RowRenderer` off the main thread; rows are bitmaps drawn
/// off the main thread, so scrolling only moves layers. Any change keeps the bottom row where it was
/// (anchoring by key), or the bottom in view when it was (stick to bottom). Rows are accessibility
/// elements with their spans; a long press selects a row's text when the row does not take it.
public final class MessageListView: UIView, UIScrollViewDelegate, UIGestureRecognizerDelegate {
    public struct Stats: Sendable {
        public var renders = 0
        public var rendersByKey: [Int: Int] = [:]
        /// A row came into view before its bitmap was ready (once per appearance), and the frames
        /// on which some visible row was still blank.
        public var blanks = 0
        public var blankFrames = 0
        public var measured = 0
        public var bitmapBytes = 0
        /// Rows whose height or entry `set` touched: the work one update costs.
        public var touchedPerSet = 0
    }

    public let scroll = UIScrollView()
    public private(set) var stats = Stats()
    /// Older entries are wanted (the far end is near).
    public var onReachStart: (() -> Void)?
    /// Newer entries are wanted (the bottom is near), once per approach.
    public var onReachEnd: (() -> Void)?
    /// The visible entries changed, as indices from the newest (option B steers JS with it).
    public var onViewport: ((Int, Int) -> Void)?
    /// After the next layout pass that shows rows with bitmaps (first frame).
    public var onShown: (() -> Void)?
    /// A press on row `key` at `point` (row coordinates); `layout` is what the row drew.
    public var onPress: ((Int, RowLayout, CGPoint) -> Void)?
    /// A long press on row `key`; true when the row took it (else its text becomes selectable).
    public var onLongPress: ((Int) -> Bool)?
    /// An accessibility element of row `key` was activated with this target's or action's event.
    public var onAccessibilityEvent: ((Int, String, JSONValue) -> Void)?

    /// Keep the bottom in view when it was (a chat); off, only the anchor row stays still.
    public var stickToBottom = true { didSet { if stickToBottom != oldValue { show() } } }
    /// Start at the newest end (a chat) rather than the oldest.
    public var anchorAtEnd = true
    /// Edge spinners: older rows loading (the far end) and newer ones (the bottom).
    public var loadingStart = false { didSet { if loadingStart != oldValue { set(keys: given.keys, entries: given.entries, dirty: []) } } }
    public var loadingEnd = false { didSet { if loadingEnd != oldValue { set(keys: given.keys, entries: given.entries, dirty: []) } } }
    /// Appearance and size class to draw with; nil follows the view's traits (the bench).
    public var dark: Bool? { didSet { if dark != oldValue { remeasureAll() } } }
    public var sizeClass: HazelTheme.SizeClass? { didSet { if sizeClass != oldValue { remeasureAll() } } }
    /// The inset each side of the rows (the list recipe's `content` padding; a chat's `px-4`).
    public var insetX: CGFloat = 0 { didSet { if insetX != oldValue { remeasureAll() } } }
    /// The width rows lay out at: the view's, less the inset each side.
    private var rowWidth: CGFloat { max(0, bounds.width - insetX * 2) }

    nonisolated static let startSpinner = Int.min
    nonisolated static let endSpinner = Int.min + 1

    /// What `set` was given, before the spinners.
    private var given: (keys: [Int], entries: [ListEntry]) = ([], [])
    private var keys: [Int] = []
    private var entries: [ListEntry] = []
    private var indexOf: [Int: Int] = [:]
    private var heights: [CGFloat] = []
    private var offsets: [CGFloat] = [0]
    /// Measured layouts by key. Placeholders measure by index (`-(index + 1)` keys).
    private var layouts: [Int: RowLayout] = [:]
    /// Row pixels by key: an IOSurface (drawn off the main thread) or a CGImage (the first frame).
    private var images: [Int: (contents: AnyObject, bytes: Int)] = [:]
    private var imageOrder: [Int] = []
    private var rendering: [Int: Operation] = [:]
    private var blankShown: Set<Int> = []
    /// Rows in view or drawn ahead: never evicted. +1 scrolls toward older rows.
    private var protected: Set<Int> = []
    private var direction = 1
    private var lastTop: CGFloat = 0
    private var layers: [Int: CALayer] = [:]
    private var pool: [CALayer] = []
    private var generation = 0
    private var lastReach = -1
    private var reachEndArmed = true
    private var lastViewport = (-1, -1)
    /// Nothing drawn yet: the first rows are drawn on the main thread, so the first frame is whole.
    private var firstPaint = true
    private var entered: Set<Int> = []
    /// Each shown row's reaction counts, so the next draw of it knows what moved; and its moving pieces.
    private var shownCounts: [Int: [String: Int]] = [:]
    private var moving: [Int: (id: Int, pieces: [CALayer], image: AnyObject)] = [:]
    private var motions = 0
    private var selection: UITextView?
    private var accessibilityCache: [Int: [UIAccessibilityElement]] = [:]
    /// Rows draw in parallel; on-screen ones jump the queue, ones scrolled past are cancelled.
    private let renderQueue: OperationQueue = {
        let q = OperationQueue()
        q.name = "sh.hazel.ui.rows"
        q.maxConcurrentOperationCount = 4
        q.qualityOfService = .userInitiated
        return q
    }()
    private let measureQueue = DispatchQueue(label: "sh.hazel.ui.measure", qos: .userInitiated)
    private static let flip = CATransform3DMakeScale(1, -1, 1)
    /// Bitmaps kept (bytes); rows beyond it are drawn again when they return.
    public var bitmapBudget = 64 * 1024 * 1024

    public override init(frame: CGRect) {
        super.init(frame: frame)
        scroll.delegate = self
        scroll.transform = CGAffineTransform(scaleX: 1, y: -1)
        scroll.showsVerticalScrollIndicator = false
        scroll.alwaysBounceVertical = true
        scroll.contentInsetAdjustmentBehavior = .never
        addSubview(scroll)
        applyBackground()
        let tap = UITapGestureRecognizer(target: self, action: #selector(tapped(_:)))
        tap.delegate = self
        addGestureRecognizer(tap)
        let hold = UILongPressGestureRecognizer(target: self, action: #selector(held(_:)))
        hold.minimumPressDuration = 0.4
        addGestureRecognizer(hold)
        registerForTraitChanges([UITraitUserInterfaceStyle.self, UITraitHorizontalSizeClass.self]) { (view: MessageListView, _) in
            view.applyBackground()
            view.remeasureAll()
        }
    }

    required init?(coder: NSCoder) { fatalError("init(coder:)") }

    public var bottomInset: CGFloat = 0 { didSet { applyInsets() } }
    public var topInset: CGFloat = 0 { didSet { applyInsets() } }
    /// Pushes short content of a start-anchored list to the top of the viewport.
    private var fillInset: CGFloat = 0

    private func applyInsets() {
        scroll.contentInset.top = bottomInset
        scroll.contentInset.bottom = topInset + fillInset
    }

    /// What rows draw with: width, size class, appearance, scale.
    public var context: RowContext {
        RowContext(
            width: rowWidth,
            sizeClass: sizeClass ?? (traitCollection.horizontalSizeClass == .regular ? .regular : .compact),
            dark: dark ?? (traitCollection.userInterfaceStyle == .dark),
            scale: window?.screen.scale ?? max(traitCollection.displayScale, 1)
        )
    }

    private func applyBackground() {
        backgroundColor = RowRenderer.background(context)
        scroll.backgroundColor = backgroundColor
    }

    public override func layoutSubviews() {
        super.layoutSubviews()
        if scroll.frame != bounds {
            let widthChanged = scroll.frame.width != bounds.width
            scroll.frame = bounds
            if widthChanged { remeasureAll() } else { rebuildOffsets() }
        }
        show()
    }

    public var isAtBottom: Bool { scroll.contentOffset.y <= -scroll.contentInset.top + 2 }

    /// Every row's height at `width`, measured now on this thread (small lists sized to their content).
    public func contentHeight(width: CGFloat) -> CGFloat {
        var c = context
        c.width = max(0, width - insetX * 2)
        let entries = self.entries
        return zip(keys, entries).enumerated().reduce(0) { sum, item in
            let (i, pair) = item
            let gap = Self.gapAbove(i, entries)
            if width == bounds.width, let hit = layouts[pair.0] { return sum + hit.height + gap }
            return sum + Self.make(pair.0, pair.1, c).height + gap
        }
    }

    /// New entries, newest first. `dirty` rows are measured again and redrawn; the rest keep theirs.
    /// When the order is unchanged only the dirty rows are touched (no pass over every row).
    public func set(keys newKeys: [Int], entries newEntries: [ListEntry], dirty: Set<Int>) {
        given = (newKeys, newEntries)
        accessibilityElementsCache = nil
        var nextKeys = newKeys, nextEntries = newEntries
        if loadingEnd { nextKeys.insert(Self.endSpinner, at: 0); nextEntries.insert(.placeholder, at: 0) }
        if loadingStart { nextKeys.append(Self.startSpinner); nextEntries.append(.placeholder) }
        let anchor = anchorNow()
        let atBottom = (stickToBottom && isAtBottom) || (keys.isEmpty && anchorAtEnd)
        let atTop = keys.isEmpty && !anchorAtEnd
        for key in dirty {
            layouts[key] = nil
            dropImage(key)
            accessibilityCache[key] = nil
        }
        let width = rowWidth
        let sameOrder = nextKeys == keys
        entries = nextEntries
        if sameOrder && !heights.isEmpty {
            // Only the dirty rows: their entries are in place, their heights and the offsets after them change.
            var first = Int.max
            for key in dirty {
                guard let i = indexOf[key] else { continue }
                if width > 0, !isPlaceholder(i) {
                    layouts[key] = Self.make(key, entries[i], context)
                    stats.measured += 1
                }
                let h = layouts[key]?.height ?? RowRenderer.estimate
                if h != heights[i] { heights[i] = h; first = min(first, i) }
            }
            stats.touchedPerSet = dirty.count
            if first != .max { shiftOffsets(from: first) }
        } else {
            let before = indexOf
            keys = nextKeys
            indexOf = Dictionary(uniqueKeysWithValues: nextKeys.enumerated().map { ($1, $0) })
            if width > 0 {
                let c = context
                // Now: the newest rows and rows changed in place. New rows further out (an older page)
                // are measured off the main thread like any other.
                for (i, key) in keys.enumerated() where layouts[key] == nil && (i < 40 || (dirty.contains(key) && before[key] != nil)) {
                    if isPlaceholder(i) { continue }
                    layouts[key] = Self.make(key, entries[i], c)
                    stats.measured += 1
                }
            }
            stats.touchedPerSet = keys.count
            rebuildOffsets()
        }
        restore(anchor, atBottom: atBottom, atTop: atTop)
        for key in Array(layers.keys) where indexOf[key] == nil || dirty.contains(key) {
            if indexOf[key] == nil { recycle(key) } else { layers[key]?.contents = nil }
        }
        show()
        measureRest()
    }

    /// A spinner or a real entry, laid out for `c`.
    nonisolated static func make(_ key: Int, _ entry: ListEntry, _ c: RowContext) -> RowLayout {
        key == startSpinner || key == endSpinner ? RowRenderer.spinner(c) : RowRenderer.layout(entry, c)
    }

    private func isPlaceholder(_ i: Int) -> Bool {
        if keys[i] == Self.startSpinner || keys[i] == Self.endSpinner { return false }
        if case .placeholder = entries[i] { return true }
        return false
    }

    // MARK: layout

    private func rebuildOffsets() {
        heights = keys.map { layouts[$0]?.height ?? RowRenderer.estimate }
        offsets = [0]
        offsets.reserveCapacity(heights.count + 1)
        var sum: CGFloat = 0
        for (i, h) in heights.enumerated() {
            sum += h + gapAbove(i)
            offsets.append(sum)
        }
        applyContentSize()
    }

    private func shiftOffsets(from first: Int) {
        var sum = offsets[first]
        for i in first..<heights.count {
            sum += heights[i] + gapAbove(i)
            offsets[i + 1] = sum
        }
        applyContentSize()
    }

    /// Chat rhythm, as the web list's (today's `mt-2`/`mb-2`, not collapsed): 8pt above an author
    /// group's first row and 8pt below its last. Entries run newest first, so `i + 1` is above `i`.
    private func gapAbove(_ i: Int) -> CGFloat {
        Self.gapAbove(i, entries)
    }

    nonisolated static func gapAbove(_ i: Int, _ entries: [ListEntry]) -> CGFloat {
        guard i + 1 < entries.count else { return 0 }
        var groupedHere = false
        var gap: CGFloat = 0
        if case let .message(row) = entries[i] {
            groupedHere = row.grouped
            if !row.grouped { gap += Token.space("2") }
        }
        if case .message = entries[i + 1], !groupedHere { gap += Token.space("2") }
        return gap
    }

    private func applyContentSize() {
        let total = offsets.last ?? 0
        scroll.contentSize = CGSize(width: bounds.width, height: total)
        let fill = anchorAtEnd ? 0 : max(0, bounds.height - total - topInset - bottomInset)
        if fill != fillInset { fillInset = fill; applyInsets() }
    }

    /// The row nearest the bottom edge that is in view, and its distance from that edge.
    private func anchorNow() -> (key: Int, delta: CGFloat)? {
        guard !keys.isEmpty, heights.count == keys.count else { return nil }
        let y = scroll.contentOffset.y + scroll.contentInset.top
        let i = index(at: max(0, y))
        guard i < keys.count else { return nil }
        return (keys[i], offsets[i] - scroll.contentOffset.y)
    }

    private func restore(_ anchor: (key: Int, delta: CGFloat)?, atBottom: Bool, atTop: Bool = false) {
        if atBottom {
            scroll.contentOffset.y = -scroll.contentInset.top
            return
        }
        if atTop {
            scroll.contentOffset.y = max(-scroll.contentInset.top, scroll.contentSize.height + scroll.contentInset.bottom - bounds.height)
            return
        }
        guard let anchor, let i = indexOf[anchor.key] else { return }
        let y = offsets[i] - anchor.delta
        if abs(y - scroll.contentOffset.y) > 0.25 { scroll.contentOffset.y = y }
    }

    /// The index of the entry covering content position `y` (binary search over offsets).
    private func index(at y: CGFloat) -> Int {
        var lo = 0, hi = heights.count
        while lo < hi {
            let mid = (lo + hi) / 2
            if offsets[mid + 1] <= y { lo = mid + 1 } else { hi = mid }
        }
        return lo
    }

    /// Measures the rest newest first, off the main thread, and applies heights in chunks.
    private func measureRest() {
        let c = context
        guard c.width > 0 else { return }
        let missing = keys.enumerated().compactMap { i, key -> (Int, ListEntry)? in
            if layouts[key] != nil || isPlaceholder(i) { return nil }
            return (key, entries[i])
        }
        guard !missing.isEmpty else { return }
        generation += 1
        let generation = self.generation
        let chunk = 200
        for start in stride(from: 0, to: missing.count, by: chunk) {
            let part = Array(missing[start..<min(missing.count, start + chunk)])
            measureQueue.async { @Sendable [weak self] in
                let made = part.map { ($0.0, MessageListView.make($0.0, $0.1, c)) }
                DispatchQueue.main.async {
                    guard let self, self.generation == generation, self.context == c else { return }
                    let anchor = self.anchorNow()
                    let atBottom = self.stickToBottom && self.isAtBottom
                    var first = Int.max
                    for (key, layout) in made {
                        guard let i = self.indexOf[key] else { continue }
                        self.layouts[key] = layout
                        if self.heights[i] != layout.height { self.heights[i] = layout.height; first = min(first, i) }
                    }
                    self.stats.measured += made.count
                    self.accessibilityElementsCache = nil
                    if first != .max { self.shiftOffsets(from: first) }
                    self.restore(anchor, atBottom: atBottom)
                    self.show()
                }
            }
        }
    }

    private func remeasureAll() {
        // Keep the reader's place: a new appearance, size class or inset re-lays rows, it does not scroll.
        let anchor = anchorNow()
        let wasAtBottom = keys.isEmpty || isAtBottom
        layouts.removeAll()
        images.removeAll()
        imageOrder.removeAll()
        accessibilityCache.removeAll()
        stats.bitmapBytes = 0
        for key in Array(layers.keys) { recycle(key) }
        applyBackground()
        keys = []
        set(keys: given.keys, entries: given.entries, dirty: [])
        if !wasAtBottom {
            restore(anchor, atBottom: false)
            show()
        }
    }

    // MARK: drawing

    private func show() {
        guard !keys.isEmpty, bounds.height > 0, heights.count == keys.count else { return }
        let top = scroll.contentOffset.y
        let visible = (max(0, top), top + bounds.height)
        let lo = index(at: visible.0)
        let hi = min(keys.count - 1, index(at: visible.1))
        guard lo <= hi, lo < keys.count else { return }
        // Draw ahead of the scroll: a screen and a half the way it moves, half a screen behind.
        let dy = top - lastTop
        if abs(dy) > 0.5 { direction = dy > 0 ? 1 : -1 }
        lastTop = top
        let forward = bounds.height * 1.5, back = bounds.height * 0.5
        let preLo = index(at: max(0, visible.0 - (direction < 0 ? forward : back)))
        let preHi = min(keys.count - 1, index(at: visible.1 + (direction > 0 ? forward : back)))
        var wanted = Set<Int>()
        for i in lo...hi { wanted.insert(keys[i]) }
        for key in Array(layers.keys) where !wanted.contains(key) { recycle(key) }
        let c = context
        var anyBlank = false
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        for i in lo...hi {
            let key = keys[i]
            let layer = layers[key] ?? take(key)
            layer.frame = CGRect(x: insetX, y: offsets[i], width: rowWidth, height: heights[i])
            guard layer.contents == nil else { continue }
            if let image = images[key] {
                present(key, image.contents, on: layer)
            } else if isPlaceholder(i) {
                layer.backgroundColor = HazelTheme.Colors.muted.ui(c.dark).cgColor
            } else if firstPaint {
                // The first frame: draw what is in view here, so it never shows blank rows.
                let layout = layouts[key] ?? Self.make(key, entries[i], c)
                layouts[key] = layout
                if let image = layout.draw(scale: c.scale) {
                    keep(key, image, bytes: image.bytesPerRow * image.height)
                    stats.renders += 1
                    stats.rendersByKey[key, default: 0] += 1
                    present(key, image, on: layer)
                }
            } else {
                anyBlank = true
                if blankShown.insert(key).inserted { stats.blanks += 1 }
                render(key, index: i, context: c, urgent: true)
            }
        }
        CATransaction.commit()
        if layers.values.contains(where: { $0.contents != nil }) { firstPaint = false }
        if anyBlank { stats.blankFrames += 1 }
        var prefetch = Set<Int>()
        for i in preLo...preHi {
            prefetch.insert(keys[i])
            if images[keys[i]] == nil { render(keys[i], index: i, context: c, urgent: false) }
        }
        protected = prefetch
        for (key, op) in rendering where !prefetch.contains(key) {
            op.cancel()
            rendering[key] = nil
        }
        if hi >= keys.count - 20, lastReach != keys.count {
            lastReach = keys.count
            onReachStart?()
        }
        let near = max(64, bounds.height / 2)
        let fromBottom = scroll.contentOffset.y + scroll.contentInset.top
        if fromBottom > near { reachEndArmed = true } else if reachEndArmed {
            reachEndArmed = false
            onReachEnd?()
        }
        if abs(lo - lastViewport.0) >= 4 || abs(hi - lastViewport.1) >= 4 {
            lastViewport = (lo, hi)
            onViewport?(lo, hi)
        }
        if let onShown, layers.values.contains(where: { $0.contents != nil }) {
            self.onShown = nil
            onShown()
        }
    }

    /// Puts a bitmap on a row's layer. A row that asks to enter plays the message's enter once; a row
    /// drawn again with changed reactions plays their motions on its pieces (`ReactionMotion`).
    private func present(_ key: Int, _ image: AnyObject, on layer: CALayer) {
        settle(key, layer)
        layer.contents = image
        guard let layout = layouts[key] else { return }
        let old = shownCounts.updateValue(layout.reactionCounts, forKey: key)
        guard HazelMotion.enabled, !HazelMotion.reduced() else { return }
        if layout.entering, entered.insert(key).inserted, let spec = HazelMotion.spec("message", .enter),
           let timeline = MotionTimeline(spec, reduceMotion: false) {
            // The layer is flipped in a flipped list: rising on screen is a positive y in its parent.
            layer.add(timeline.layerAnimation(size: layer.bounds.size, flipped: true), forKey: "enter")
        }
        let plays = ReactionMotion.plan("message", from: old, to: layout, reduceMotion: false)
        let scale = context.scale
        guard !plays.isEmpty,
              let base = layout.draw(scale: scale, skipping: ReactionMotion.skipping(plays)) else { return }
        layer.contents = base
        let pieces = ReactionMotion.layers(plays, layout, scale: scale)
        pieces.forEach(layer.addSublayer)
        motions += 1
        let id = motions
        moving[key] = (id, pieces, image)
        DispatchQueue.main.asyncAfter(deadline: .now() + ReactionMotion.duration(plays)) { [weak self] in
            guard let self, self.moving[key]?.id == id, let layer = self.layers[key] else { return }
            CATransaction.begin()
            CATransaction.setDisableActions(true)
            self.settle(key, layer)
            CATransaction.commit()
        }
    }

    /// Ends a row's reaction motion: the whole bitmap back, its pieces gone.
    private func settle(_ key: Int, _ layer: CALayer?) {
        guard let motion = moving.removeValue(forKey: key) else { return }
        motion.pieces.forEach { $0.removeFromSuperlayer() }
        if let layer, layer.contents != nil { layer.contents = motion.image }
    }

    private func render(_ key: Int, index i: Int, context c: RowContext, urgent: Bool) {
        guard i < entries.count else { return }
        if let pending = rendering[key] {
            if urgent { pending.queuePriority = .veryHigh }
            return
        }
        if isPlaceholder(i) { return }
        let entry = entries[i]
        let layout = layouts[key]
        let work = BlockOperation()
        work.queuePriority = urgent ? .veryHigh : .normal
        work.addExecutionBlock { @Sendable [weak self, weak work] in
            if work?.isCancelled == true { return }
            let made = layout ?? MessageListView.make(key, entry, c)
            let image = made.surface(scale: c.scale)
            DispatchQueue.main.async {
                guard let self else { return }
                if self.rendering[key] === work { self.rendering[key] = nil }
                guard self.indexOf[key] != nil, self.context == c, let image else { return }
                if self.layouts[key] == nil { self.layouts[key] = made }
                self.stats.renders += 1
                self.stats.rendersByKey[key, default: 0] += 1
                self.keep(key, image.surface, bytes: image.bytes)
                if let layer = self.layers[key] {
                    CATransaction.begin()
                    CATransaction.setDisableActions(true)
                    self.present(key, image.surface, on: layer)
                    CATransaction.commit()
                }
                if self.onShown != nil { self.show() }
            }
        }
        rendering[key] = work
        renderQueue.addOperation(work)
    }

    private func keep(_ key: Int, _ image: AnyObject, bytes: Int) {
        dropImage(key)
        images[key] = (image, bytes)
        imageOrder.append(key)
        stats.bitmapBytes += bytes
        // Over budget: drop the least recent bitmaps outside what is shown or drawn ahead.
        while stats.bitmapBytes > bitmapBudget,
              let victim = imageOrder.first(where: { !protected.contains($0) && layers[$0] == nil }) {
            dropImage(victim)
        }
    }

    private func dropImage(_ key: Int) {
        guard let image = images.removeValue(forKey: key) else { return }
        stats.bitmapBytes -= image.bytes
        if let i = imageOrder.firstIndex(of: key) { imageOrder.remove(at: i) }
    }

    private func take(_ key: Int) -> CALayer {
        let layer = pool.popLast() ?? {
            let l = CALayer()
            l.transform = Self.flip
            l.contentsGravity = .resize
            l.isOpaque = true
            return l
        }()
        layer.contents = nil
        layer.backgroundColor = nil
        layers[key] = layer
        scroll.layer.addSublayer(layer)
        return layer
    }

    private func recycle(_ key: Int) {
        blankShown.remove(key)
        shownCounts[key] = nil
        if let motion = moving.removeValue(forKey: key) { motion.pieces.forEach { $0.removeFromSuperlayer() } }
        guard let layer = layers.removeValue(forKey: key) else { return }
        layer.removeAllAnimations()
        layer.removeFromSuperlayer()
        layer.contents = nil
        pool.append(layer)
    }

    /// Zeroes the blank and render counters (bitmap bytes stay true).
    public func resetStats() {
        stats = Stats(bitmapBytes: stats.bitmapBytes)
    }

    public func scrollViewDidScroll(_ scrollView: UIScrollView) { show() }

    public func scrollViewWillBeginDragging(_ scrollView: UIScrollView) { endSelection() }

    // MARK: scrolling

    /// Scrolls to the newest end (`end`), the oldest (`start`), or brings row `index` (oldest first,
    /// as the list's children are ordered) into view.
    public func scroll(toEdge end: Bool, animated: Bool) {
        let y = end ? -scroll.contentInset.top : max(-scroll.contentInset.top, scroll.contentSize.height + scroll.contentInset.bottom - bounds.height)
        scroll.setContentOffset(CGPoint(x: 0, y: y), animated: animated)
    }

    public func scroll(toRow childIndex: Int, animated: Bool) {
        let i = given.keys.count - 1 - childIndex + (loadingEnd ? 1 : 0)
        guard i >= 0, i < heights.count else { return }
        let top = scroll.contentOffset.y, visible = bounds.height - scroll.contentInset.top - scroll.contentInset.bottom
        var y = top
        if offsets[i] < top + scroll.contentInset.top { y = offsets[i] - scroll.contentInset.top }
        else if offsets[i + 1] > top + scroll.contentInset.top + visible { y = offsets[i + 1] - scroll.contentInset.top - visible }
        scroll.setContentOffset(CGPoint(x: 0, y: y), animated: animated)
    }

    // MARK: presses

    /// Row `i`'s rect in this view's (unflipped) coordinates.
    private func screenRect(_ i: Int) -> CGRect {
        CGRect(x: insetX, y: bounds.height - (offsets[i + 1] - scroll.contentOffset.y), width: rowWidth, height: heights[i])
    }

    /// The row under `point` (this view's coordinates) and the point in the row's own coordinates.
    private func row(at point: CGPoint) -> (Int, CGPoint)? {
        guard !keys.isEmpty, heights.count == keys.count else { return nil }
        let y = bounds.height - point.y + scroll.contentOffset.y
        let i = index(at: y)
        guard i < keys.count, y >= 0 else { return nil }
        let rect = screenRect(i)
        return (i, CGPoint(x: point.x - rect.minX, y: point.y - rect.minY))
    }

    @objc private func tapped(_ gesture: UITapGestureRecognizer) {
        if selection != nil { endSelection(); return }
        guard let (i, local) = row(at: gesture.location(in: self)), let layout = layouts[keys[i]] else { return }
        onPress?(keys[i], layout, local)
    }

    @objc private func held(_ gesture: UILongPressGestureRecognizer) {
        guard gesture.state == .began, let (i, local) = row(at: gesture.location(in: self)) else { return }
        // A hold opens the row's menu wherever it lands; text is selected only through the menu's
        // "Select Text" (`selectText`), as in Messages. A row with no menu selects its text.
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        if onLongPress?(keys[i]) == true { return }
        beginSelection(i, at: local)
    }

    /// `selectText` (`message-select-text`): selects row `key`'s text natively; the caller then reports it.
    public func selectText(_ key: Int) {
        guard let i = indexOf[key], let block = layouts[key]?.selectable.first else { return }
        beginSelection(i, at: CGPoint(x: block.rect.midX, y: block.rect.midY))
    }

    public func gestureRecognizer(_ g: UIGestureRecognizer, shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer) -> Bool { true }

    // MARK: text selection

    /// Lays a selectable text view over the text block under `point` in row `i`, its words selected.
    /// The bitmap stays below; the overlay's own glyphs are clear, so only the selection shows.
    private func beginSelection(_ i: Int, at point: CGPoint) {
        endSelection()
        guard let layout = layouts[keys[i]], let block = layout.selectable.first(where: { $0.rect.insetBy(dx: -8, dy: -4).contains(point) }) ?? layout.selectable.first else { return }
        let rowRect = screenRect(i)
        let view = UITextView(frame: block.rect.offsetBy(dx: rowRect.minX, dy: rowRect.minY))
        view.isEditable = false
        view.isSelectable = true
        view.isScrollEnabled = false
        view.backgroundColor = .clear
        view.textContainerInset = .zero
        view.textContainer.lineFragmentPadding = 0
        let clear = NSMutableAttributedString(attributedString: block.text)
        clear.addAttribute(.foregroundColor, value: UIColor.clear, range: NSRange(location: 0, length: clear.length))
        clear.removeAttribute(.backgroundColor, range: NSRange(location: 0, length: clear.length))
        view.attributedText = clear
        view.tintColor = HazelTheme.Colors.primary.ui(context.dark)
        addSubview(view)
        selection = view
        view.becomeFirstResponder()
        view.selectedRange = NSRange(location: 0, length: clear.length)
    }

    public func endSelection() {
        selection?.removeFromSuperview()
        selection = nil
    }

    /// Whether a selection overlay is showing (tests and the gallery).
    public var isSelecting: Bool { selection != nil }

    // MARK: accessibility

    /// The elements for the visible range they were built for; scrolling within it reuses them
    /// (their frames are read live), so an accessibility client polling during a fling costs nothing.
    private var accessibilityElementsCache: (range: ClosedRange<Int>, elements: [Any])?

    public override var isAccessibilityElement: Bool { get { false } set {} }

    /// The rows in view, oldest first, each followed by its pressable spans (mentions, links,
    /// reactions, attachments, the thread card), framed where they are drawn.
    public override var accessibilityElements: [Any]? {
        get {
            guard !keys.isEmpty, heights.count == keys.count, bounds.height > 0 else { return [] }
            let top = scroll.contentOffset.y
            let lo = index(at: max(0, top)), hi = min(keys.count - 1, index(at: top + bounds.height))
            guard lo <= hi else { return [] }
            if let cached = accessibilityElementsCache, cached.range == lo...hi { return cached.elements }
            var out: [Any] = []
            for i in stride(from: hi, through: lo, by: -1) {
                let key = keys[i]
                guard let layout = layouts[key] else { continue }
                if accessibilityCache[key] == nil { accessibilityCache[key] = elements(key, layout) }
                out.append(contentsOf: accessibilityCache[key] ?? [])
            }
            accessibilityElementsCache = (lo...hi, out)
            return out
        }
        set {}
    }

    /// Where `local` (row coordinates) of row `key` is on screen now.
    fileprivate func screenFrame(_ key: Int, _ local: CGRect?) -> CGRect {
        guard let i = indexOf[key], i < heights.count else { return .zero }
        let rect = screenRect(i)
        let frame = (local ?? CGRect(origin: .zero, size: rect.size)).offsetBy(dx: rect.minX, dy: rect.minY)
        return UIAccessibility.convertToScreenCoordinates(frame, in: self)
    }

    private func elements(_ key: Int, _ layout: RowLayout) -> [UIAccessibilityElement] {
        let row = RowElement(list: self, key: key, local: nil)
        row.accessibilityLabel = layout.label
        row.accessibilityTraits = key == Self.startSpinner || key == Self.endSpinner ? .updatesFrequently : .staticText
        var actions = layout.actions.map { action in
            UIAccessibilityCustomAction(name: action.label) { [weak self] _ in
                // The host acts first on `selectText`, then reports it.
                if action.payload.object?["action"]?.string == "selectText" { self?.selectText(key) }
                self?.onAccessibilityEvent?(key, action.event, action.payload)
                return true
            }
        }
        if !layout.selectable.isEmpty {
            actions.append(UIAccessibilityCustomAction(name: "Copy text") { _ in
                UIPasteboard.general.string = layout.selectable.map(\.text.string).joined(separator: "\n")
                return true
            })
        }
        row.accessibilityCustomActions = actions
        var out: [UIAccessibilityElement] = [row]
        for target in layout.targets where target.event != "press" {
            let span = RowElement(list: self, key: key, local: target.rect)
            span.accessibilityLabel = target.label
            var traits: UIAccessibilityTraits = target.role == .link ? .link : target.role == .image ? [.image, .button] : .button
            if target.selected { traits.insert(.selected) }
            span.accessibilityTraits = traits
            span.activate = { [weak self] in self?.onAccessibilityEvent?(key, target.event, target.payload) }
            out.append(span)
        }
        return out
    }

    public override func accessibilityScroll(_ direction: UIAccessibilityScrollDirection) -> Bool {
        let page = bounds.height * 0.8
        let dy: CGFloat = direction == .up ? page : direction == .down ? -page : 0
        guard dy != 0 else { return false }
        let maxY = scroll.contentSize.height + scroll.contentInset.bottom - bounds.height
        scroll.contentOffset.y = min(max(-scroll.contentInset.top, scroll.contentOffset.y + dy), max(-scroll.contentInset.top, maxY))
        UIAccessibility.post(notification: .pageScrolled, argument: nil)
        return true
    }

    // MARK: tests

    /// The key and on-screen distance from the bottom edge of the row at the bottom, for tests.
    public var bottomRow: (key: Int, delta: CGFloat)? { anchorNow() }
    public func frameOfRow(_ key: Int) -> CGRect? {
        guard let i = indexOf[key] else { return nil }
        return CGRect(x: insetX, y: offsets[i] - scroll.contentOffset.y, width: rowWidth, height: heights[i])
    }
    public var count: Int { keys.count }
    /// The layout drawn for row `key`, if measured.
    public func layout(of key: Int) -> RowLayout? { layouts[key] }
}

/// A row of the bitmap list, or one pressable span of it, for VoiceOver; its frame is read live.
private final class RowElement: UIAccessibilityElement {
    weak var list: MessageListView?
    let key: Int
    let local: CGRect?
    var activate: (() -> Void)?

    init(list: MessageListView, key: Int, local: CGRect?) {
        self.list = list
        self.key = key
        self.local = local
        super.init(accessibilityContainer: list)
    }

    override var accessibilityFrame: CGRect {
        get { list?.screenFrame(key, local) ?? .zero }
        set {}
    }

    override func accessibilityActivate() -> Bool {
        activate?()
        return activate != nil
    }
}
