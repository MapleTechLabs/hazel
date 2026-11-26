import UIKit

/// The native message list (G7): bottom-anchored, lazy, built for the frame budget.
///
/// Inverted (the newest entry at the content's origin), so older pages extend the far end and never
/// move what is on screen. Heights come from `RowRenderer.layout` off the main thread; rows are
/// bitmaps drawn off the main thread, so scrolling only moves layers. Any change keeps the first
/// visible row where it was (anchoring by key), or the bottom in view when it was (stick to bottom).
public final class MessageListView: UIView, UIScrollViewDelegate {
    public struct Stats: Sendable {
        public var renders = 0
        public var rendersByKey: [Int: Int] = [:]
        /// A row came into view before its bitmap was ready (once per appearance), and the frames
        /// on which some visible row was still blank.
        public var blanks = 0
        public var blankFrames = 0
        public var measured = 0
        public var bitmapBytes = 0
    }

    public let scroll = UIScrollView()
    public private(set) var stats = Stats()
    /// Older entries are wanted (the far end is near).
    public var onReachStart: (() -> Void)?
    /// The visible entries changed, as indices from the newest (option B steers JS with it).
    public var onViewport: ((Int, Int) -> Void)?
    /// After the next layout pass that shows rows with bitmaps (first frame).
    public var onShown: (() -> Void)?

    private var keys: [Int] = []
    private var entries: [ListEntry] = []
    private var indexOf: [Int: Int] = [:]
    private var heights: [CGFloat] = []
    private var offsets: [CGFloat] = [0]
    /// Measured layouts by key. Placeholders measure by index (`-(index + 1)` keys).
    private var layouts: [Int: RowLayout] = [:]
    private var images: [Int: CGImage] = [:]
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
    private var lastViewport = (-1, -1)
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
        backgroundColor = .white
        scroll.delegate = self
        scroll.transform = CGAffineTransform(scaleX: 1, y: -1)
        scroll.showsVerticalScrollIndicator = false
        scroll.alwaysBounceVertical = true
        scroll.contentInsetAdjustmentBehavior = .never
        scroll.backgroundColor = .white
        addSubview(scroll)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:)") }

    public var bottomInset: CGFloat = 0 {
        didSet { scroll.contentInset.top = bottomInset; scroll.contentInset.bottom = topInset }
    }
    public var topInset: CGFloat = 0 {
        didSet { scroll.contentInset.bottom = topInset }
    }

    public override func layoutSubviews() {
        super.layoutSubviews()
        if scroll.frame != bounds {
            let widthChanged = scroll.frame.width != bounds.width
            scroll.frame = bounds
            if widthChanged { remeasureAll() }
        }
        show()
    }

    public var isAtBottom: Bool { scroll.contentOffset.y <= -scroll.contentInset.top + 2 }

    /// New entries, newest first. `dirty` rows are measured again and redrawn; the rest keep theirs.
    public func set(keys newKeys: [Int], entries newEntries: [ListEntry], dirty: Set<Int>) {
        let anchor = anchorNow()
        let atBottom = isAtBottom || keys.isEmpty
        for key in dirty {
            layouts[key] = nil
            dropImage(key)
        }
        // A placeholder that became a row (option B) is measured fresh; drop what no longer exists.
        keys = newKeys
        entries = newEntries
        indexOf = Dictionary(uniqueKeysWithValues: newKeys.enumerated().map { ($1, $0) })
        let width = bounds.width
        if width > 0 {
            for (i, key) in keys.enumerated() where layouts[key] == nil && (dirty.contains(key) || i < 40) {
                if case .placeholder = entries[i] { continue }
                layouts[key] = RowRenderer.layout(entries[i], width: width)
                stats.measured += 1
            }
        }
        rebuildOffsets()
        restore(anchor, atBottom: atBottom)
        for key in Array(layers.keys) where indexOf[key] == nil || dirty.contains(key) {
            if indexOf[key] == nil { recycle(key) } else { layers[key]?.contents = nil }
        }
        show()
        measureRest()
    }

    // MARK: layout

    private func rebuildOffsets() {
        heights = keys.map { layouts[$0]?.height ?? RowRenderer.estimate }
        offsets = [0]
        offsets.reserveCapacity(heights.count + 1)
        var sum: CGFloat = 0
        for h in heights {
            sum += h
            offsets.append(sum)
        }
        scroll.contentSize = CGSize(width: bounds.width, height: sum)
    }

    /// The row nearest the bottom edge that is in view, and its distance from that edge.
    private func anchorNow() -> (key: Int, delta: CGFloat)? {
        guard !keys.isEmpty else { return nil }
        let y = scroll.contentOffset.y + scroll.contentInset.top
        let i = index(at: max(0, y))
        guard i < keys.count else { return nil }
        return (keys[i], offsets[i] - scroll.contentOffset.y)
    }

    private func restore(_ anchor: (key: Int, delta: CGFloat)?, atBottom: Bool) {
        if atBottom {
            scroll.contentOffset.y = -scroll.contentInset.top
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
        let width = bounds.width
        guard width > 0 else { return }
        let missing = keys.enumerated().compactMap { i, key -> (Int, ListEntry)? in
            if layouts[key] != nil { return nil }
            if case .placeholder = entries[i] { return nil }
            return (key, entries[i])
        }
        guard !missing.isEmpty else { return }
        generation += 1
        let generation = self.generation
        let chunk = 200
        for start in stride(from: 0, to: missing.count, by: chunk) {
            let part = Array(missing[start..<min(missing.count, start + chunk)])
            measureQueue.async { @Sendable [weak self] in
                let made = part.map { ($0.0, RowRenderer.layout($0.1, width: width)) }
                DispatchQueue.main.async {
                    guard let self, self.generation == generation, self.bounds.width == width else { return }
                    let anchor = self.anchorNow()
                    let atBottom = self.isAtBottom
                    for (key, layout) in made where self.indexOf[key] != nil { self.layouts[key] = layout }
                    self.stats.measured += made.count
                    self.rebuildOffsets()
                    self.restore(anchor, atBottom: atBottom)
                    self.show()
                }
            }
        }
    }

    private func remeasureAll() {
        layouts.removeAll()
        images.removeAll()
        imageOrder.removeAll()
        stats.bitmapBytes = 0
        for key in Array(layers.keys) { recycle(key) }
        set(keys: keys, entries: entries, dirty: [])
    }

    // MARK: drawing

    private func show() {
        guard !keys.isEmpty, bounds.height > 0 else { return }
        let top = scroll.contentOffset.y
        let visible = (max(0, top), top + bounds.height)
        let lo = index(at: visible.0)
        let hi = min(keys.count - 1, index(at: visible.1))
        guard lo <= hi else { return }
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
        let scale = window?.screen.scale ?? 3
        var anyBlank = false
        CATransaction.begin()
        CATransaction.setDisableActions(true)
        for i in lo...hi {
            let key = keys[i]
            let layer = layers[key] ?? take(key)
            layer.frame = CGRect(x: 0, y: offsets[i], width: bounds.width, height: heights[i])
            if layer.contents == nil {
                if let image = images[key] {
                    layer.contents = image
                } else if case .placeholder = entries[i] {
                    layer.backgroundColor = RowRenderer.wash.cgColor
                } else {
                    anyBlank = true
                    if blankShown.insert(key).inserted { stats.blanks += 1 }
                    render(key, index: i, scale: scale, urgent: true)
                }
            }
        }
        CATransaction.commit()
        if anyBlank { stats.blankFrames += 1 }
        var prefetch = Set<Int>()
        for i in preLo...preHi {
            prefetch.insert(keys[i])
            if images[keys[i]] == nil { render(keys[i], index: i, scale: scale, urgent: false) }
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
        if abs(lo - lastViewport.0) >= 4 || abs(hi - lastViewport.1) >= 4 {
            lastViewport = (lo, hi)
            onViewport?(lo, hi)
        }
        if let onShown, layers.values.contains(where: { $0.contents != nil }) {
            self.onShown = nil
            onShown()
        }
    }

    private func render(_ key: Int, index i: Int, scale: CGFloat, urgent: Bool) {
        guard i < entries.count else { return }
        if let pending = rendering[key] {
            if urgent { pending.queuePriority = .veryHigh }
            return
        }
        if case .placeholder = entries[i] { return }
        let entry = entries[i]
        let layout = layouts[key]
        let width = bounds.width
        let work = BlockOperation()
        work.queuePriority = urgent ? .veryHigh : .normal
        work.addExecutionBlock { @Sendable [weak self, weak work] in
            if work?.isCancelled == true { return }
            let made = layout ?? RowRenderer.layout(entry, width: width)
            let image = RowRenderer.draw(made, scale: scale)
            DispatchQueue.main.async {
                guard let self else { return }
                if self.rendering[key] === work { self.rendering[key] = nil }
                guard self.indexOf[key] != nil, let image else { return }
                if self.layouts[key] == nil { self.layouts[key] = made }
                self.stats.renders += 1
                self.stats.rendersByKey[key, default: 0] += 1
                self.keep(key, image)
                if let layer = self.layers[key] {
                    CATransaction.begin()
                    CATransaction.setDisableActions(true)
                    layer.contents = image
                    CATransaction.commit()
                }
                if self.onShown != nil { self.show() }
            }
        }
        rendering[key] = work
        renderQueue.addOperation(work)
    }

    private func keep(_ key: Int, _ image: CGImage) {
        dropImage(key)
        images[key] = image
        imageOrder.append(key)
        stats.bitmapBytes += image.bytesPerRow * image.height
        // Over budget: drop the least recent bitmaps outside what is shown or drawn ahead.
        while stats.bitmapBytes > bitmapBudget,
              let victim = imageOrder.first(where: { !protected.contains($0) && layers[$0] == nil }) {
            dropImage(victim)
        }
    }

    private func dropImage(_ key: Int) {
        guard let image = images.removeValue(forKey: key) else { return }
        stats.bitmapBytes -= image.bytesPerRow * image.height
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
        guard let layer = layers.removeValue(forKey: key) else { return }
        layer.removeFromSuperlayer()
        layer.contents = nil
        pool.append(layer)
    }

    /// Zeroes the blank and render counters (bitmap bytes stay true).
    public func resetStats() {
        stats = Stats(bitmapBytes: stats.bitmapBytes)
    }

    public func scrollViewDidScroll(_ scrollView: UIScrollView) { show() }

    /// The key and on-screen distance from the bottom edge of the row at the bottom, for tests.
    public var bottomRow: (key: Int, delta: CGFloat)? { anchorNow() }
    public func frameOfRow(_ key: Int) -> CGRect? {
        guard let i = indexOf[key] else { return nil }
        return CGRect(x: 0, y: offsets[i] - scroll.contentOffset.y, width: bounds.width, height: heights[i])
    }
    public var count: Int { keys.count }
}
