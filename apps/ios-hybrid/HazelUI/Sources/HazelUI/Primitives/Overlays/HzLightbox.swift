import SwiftUI
import UIKit

// `hz:lightbox` on iOS (lane S3): the photo viewer, in a window of its own above the app (toasts stay
// above it). The image grows out of its tile in the list and flies back into it (`MediaFrames`);
// with no tile on screen it fades. Pages swipe sideways (a paging scroll view, so momentum and the
// edges are the system's), each page pinches and double-taps to zoom, a tap shows or hides the bar,
// and a pull down shrinks the photo toward its tile and lets go of it past a threshold.
// Props: `open`, `items` (attachments), `index`. Events: `change {index}` when the page changes, and
// `dismiss` once the closing motion has played.
struct HzLightbox: View {
    let tree: Tree
    let node: Node

    var body: some View {
        let request = LightboxRequest(node)
        Color.clear.frame(width: 0, height: 0)
            .onChange(of: request, initial: true) { _, request in
                LightboxPresenter.shared.update(tree, node.id, request)
            }
            .onDisappear { LightboxPresenter.shared.close(node.id) }
    }
}

/// What the node asks for: open or not, the pictures, and the page.
struct LightboxRequest: Equatable {
    let open: Bool
    let items: [LightboxItem]
    let index: Int

    @MainActor init(_ node: Node) {
        open = node[prop: "open"]?.bool == true
        items = (node[prop: "items"]?.array ?? []).compactMap { value in
            guard let a = RowData.attachment(value), a.kind == .image, let url = a.url, !url.isEmpty else { return nil }
            return LightboxItem(id: a.id, url: url, name: a.name, width: a.width, height: a.height)
        }
        index = Int(node[prop: "index"]?.number ?? 0)
    }
}

struct LightboxItem: Equatable {
    let id: String
    let url: String
    let name: String
    let width: Double?
    let height: Double?
}

/// The one lightbox window; a node opens it and closes it, the viewer's own close tells the node.
@MainActor
final class LightboxPresenter {
    static let shared = LightboxPresenter()

    private var window: UIWindow?
    private var owner: NodeId?
    private weak var controller: LightboxController?

    func update(_ tree: Tree, _ id: NodeId, _ request: LightboxRequest) {
        if !request.open || request.items.isEmpty {
            if owner == id { controller?.close() }
            return
        }
        if let controller, owner == id {
            controller.show(items: request.items, index: request.index)
            return
        }
        teardown()
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        let scene = scenes.first { $0.activationState == .foregroundActive } ?? scenes.first
        let window = scene.map { UIWindow(windowScene: $0) } ?? UIWindow(frame: UIScreen.main.bounds)
        // Under the toasts (`.alert`), over the app and its sheets.
        window.windowLevel = UIWindow.Level(rawValue: UIWindow.Level.alert.rawValue - 1)
        let controller = LightboxController(items: request.items, index: min(max(request.index, 0), request.items.count - 1))
        controller.onChange = { index in _ = tree.fire(id, "change", ["index": .number(Double(index))]) }
        controller.onClosed = { [weak self] in
            _ = tree.fire(id, "dismiss")
            self?.teardown()
        }
        window.rootViewController = controller
        window.isHidden = false
        window.makeKey()
        self.window = window
        self.controller = controller
        owner = id
    }

    /// The node went away: the viewer goes too, at once.
    func close(_ id: NodeId) {
        guard owner == id else { return }
        teardown()
    }

    private func teardown() {
        window?.isHidden = true
        window = nil
        controller = nil
        owner = nil
    }
}

// MARK: - the viewer

final class LightboxController: UIViewController, UIScrollViewDelegate, UIGestureRecognizerDelegate {
    var onChange: ((Int) -> Void)?
    var onClosed: (() -> Void)?

    private var items: [LightboxItem]
    private var index: Int
    private let backdrop = UIView()
    private let pager = UIScrollView()
    private var pages: [LightboxPage] = []
    private let bar = UIView()
    private let counter = UILabel()
    private let closeButton = UIButton(type: .system)
    private let strip = LightboxThumbStrip()
    private var chromeHidden = false
    private var isClosing = false
    private var hasAppeared = false
    /// Between pages, as in Photos.
    private let gutter: CGFloat = 20
    private var pull: UIPanGestureRecognizer!
    /// A jump the code asked for (a thumbnail, the arrow keys): one tick for it, none per page passed.
    private var isJumping = false
    /// The pull is past the point where letting go closes: crossing it either way taps once.
    private var pullArmed = false
    private let selection = UISelectionFeedbackGenerator()
    private let pullTap = UIImpactFeedbackGenerator(style: .light)

    /// The tile's corner as the list draws it (`attachmentGrid` media, `rounded-lg`).
    private static let tileRadius: CGFloat = 8
    private static let open = (duration: 0.44, damping: 0.86)
    private static let shut = (duration: 0.36, damping: 0.92)
    /// How far a pull goes before letting go closes the viewer.
    private static let pullThreshold: CGFloat = 110

    init(items: [LightboxItem], index: Int) {
        self.items = items
        self.index = index
        super.init(nibName: nil, bundle: nil)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:)") }

    override var prefersStatusBarHidden: Bool { chromeHidden }
    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }
    override var prefersHomeIndicatorAutoHidden: Bool { chromeHidden }

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = .clear
        backdrop.backgroundColor = .black
        backdrop.alpha = 0
        view.addSubview(backdrop)

        pager.isPagingEnabled = true
        pager.showsHorizontalScrollIndicator = false
        pager.showsVerticalScrollIndicator = false
        pager.contentInsetAdjustmentBehavior = .never
        pager.delegate = self
        pager.alpha = 0
        view.addSubview(pager)
        buildPages()

        bar.alpha = 0
        view.addSubview(bar)
        counter.textColor = .white
        counter.font = .monospacedDigitSystemFont(ofSize: 15, weight: .semibold)
        counter.textAlignment = .center
        bar.addSubview(counter)
        let symbol = UIImage(systemName: "xmark", withConfiguration: UIImage.SymbolConfiguration(pointSize: 15, weight: .semibold))
        closeButton.setImage(symbol, for: .normal)
        closeButton.tintColor = .white
        closeButton.backgroundColor = UIColor(white: 1, alpha: 0.16)
        closeButton.layer.cornerRadius = 22
        closeButton.accessibilityLabel = "Close"
        closeButton.addTarget(self, action: #selector(pressedClose), for: .touchUpInside)
        bar.addSubview(closeButton)

        strip.alpha = 0
        strip.onSelect = { [weak self] i in self?.go(to: i, animated: true) }
        view.addSubview(strip)
        strip.set(items: items, selected: index)

        let tap = UITapGestureRecognizer(target: self, action: #selector(tapped(_:)))
        let doubleTap = UITapGestureRecognizer(target: self, action: #selector(doubleTapped(_:)))
        // The bar's button and the thumbnails take their own taps, whole.
        for each in [tap, doubleTap] {
            each.delegate = self
            each.cancelsTouchesInView = false
        }
        doubleTap.numberOfTapsRequired = 2
        tap.require(toFail: doubleTap)
        view.addGestureRecognizer(tap)
        view.addGestureRecognizer(doubleTap)
        pull = UIPanGestureRecognizer(target: self, action: #selector(pulled(_:)))
        pull.delegate = self
        view.addGestureRecognizer(pull)
        updateCounter()
        view.accessibilityViewIsModal = true
    }

    override func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        backdrop.frame = view.bounds
        let width = view.bounds.width + gutter
        pager.frame = CGRect(x: -gutter / 2, y: 0, width: width, height: view.bounds.height)
        pager.contentSize = CGSize(width: width * CGFloat(items.count), height: view.bounds.height)
        for (i, page) in pages.enumerated() {
            page.frame = CGRect(x: width * CGFloat(i) + gutter / 2, y: 0, width: view.bounds.width, height: view.bounds.height)
        }
        pager.contentOffset = CGPoint(x: width * CGFloat(index), y: 0)
        let top = view.safeAreaInsets.top
        bar.frame = CGRect(x: 0, y: 0, width: view.bounds.width, height: top + 56)
        closeButton.frame = CGRect(x: view.bounds.width - 16 - 44, y: top + 6, width: 44, height: 44)
        counter.frame = CGRect(x: 72, y: top + 6, width: view.bounds.width - 144, height: 44)
        let bottom = view.safeAreaInsets.bottom
        strip.isHidden = items.count < 2
        strip.frame = CGRect(x: 0, y: view.bounds.height - bottom - LightboxThumbStrip.height - 8, width: view.bounds.width, height: LightboxThumbStrip.height)
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        guard !hasAppeared else { return }
        hasAppeared = true
        view.layoutIfNeeded()
        playOpen()
    }

    override var keyCommands: [UIKeyCommand]? {
        [
            UIKeyCommand(input: UIKeyCommand.inputEscape, modifierFlags: [], action: #selector(pressedClose)),
            UIKeyCommand(input: UIKeyCommand.inputLeftArrow, modifierFlags: [], action: #selector(showPrevious)),
            UIKeyCommand(input: UIKeyCommand.inputRightArrow, modifierFlags: [], action: #selector(showNext)),
        ]
    }

    private func buildPages() {
        pages.forEach { $0.removeFromSuperview() }
        pages = items.map { item in
            let page = LightboxPage(item: item)
            pager.addSubview(page)
            return page
        }
        // The open page and its neighbours load their full pictures; the rest when they come near.
        loadAround(index)
    }

    /// The open page and its neighbours hold their full pictures; the others give theirs back, so a
    /// long gallery keeps three full decodes, not one per photo.
    private func loadAround(_ i: Int) {
        for (j, page) in pages.enumerated() {
            if abs(j - i) <= 1 { page.loadFull() } else { page.unloadFull() }
        }
    }

    /// The node's items or page changed while open (another message's media, or its echo of a swipe).
    func show(items: [LightboxItem], index: Int) {
        let target = min(max(index, 0), items.count - 1)
        if items != self.items {
            self.items = items
            self.index = target
            buildPages()
            strip.set(items: items, selected: target)
            view.setNeedsLayout()
        } else if target != self.index {
            go(to: target, animated: true)
        }
        updateCounter()
    }

    private func go(to i: Int, animated: Bool) {
        guard i >= 0, i < items.count, i != index else { return }
        if animated {
            isJumping = true
            selection.selectionChanged()
        }
        pager.setContentOffset(CGPoint(x: pager.bounds.width * CGFloat(i), y: 0), animated: animated)
    }

    func scrollViewDidEndScrollingAnimation(_ scrollView: UIScrollView) {
        if scrollView === pager { isJumping = false }
    }

    func scrollViewWillBeginDragging(_ scrollView: UIScrollView) {
        if scrollView === pager { isJumping = false }
    }

    @objc private func showPrevious() { go(to: index - 1, animated: true) }
    @objc private func showNext() { go(to: index + 1, animated: true) }

    private var current: LightboxPage? { pages.indices.contains(index) ? pages[index] : nil }

    private func updateCounter() {
        counter.text = items.count > 1 ? "\(index + 1) of \(items.count)" : nil
        counter.accessibilityLabel = items.indices.contains(index) ? "\(items[index].name), \(index + 1) of \(items.count)" : nil
    }

    // MARK: paging

    func scrollViewDidScroll(_ scrollView: UIScrollView) {
        guard scrollView === pager, pager.bounds.width > 0, !isClosing else { return }
        let i = Int((pager.contentOffset.x / pager.bounds.width).rounded())
        guard i != index, i >= 0, i < items.count else { return }
        pages[index].resetZoom()
        index = i
        loadAround(i)
        updateCounter()
        strip.select(i, animated: true)
        if !isJumping { selection.selectionChanged() }
        onChange?(i)
    }

    // MARK: taps

    @objc private func tapped(_ gesture: UITapGestureRecognizer) {
        setChrome(hidden: !chromeHidden)
    }

    @objc private func doubleTapped(_ gesture: UITapGestureRecognizer) {
        guard let page = current else { return }
        page.toggleZoom(at: gesture.location(in: page.imageView))
    }

    private func setChrome(hidden: Bool) {
        chromeHidden = hidden
        UIView.animate(withDuration: 0.2) {
            self.bar.alpha = hidden ? 0 : 1
            self.strip.alpha = hidden ? 0 : 1
            self.setNeedsStatusBarAppearanceUpdate()
            self.setNeedsUpdateOfHomeIndicatorAutoHidden()
        }
    }

    @objc private func pressedClose() { close() }

    // MARK: pull to dismiss

    func gestureRecognizer(_ gesture: UIGestureRecognizer, shouldReceive touch: UITouch) -> Bool {
        guard gesture !== pull, let touched = touch.view else { return true }
        return !touched.isDescendant(of: bar) && !touched.isDescendant(of: strip)
    }

    func gestureRecognizerShouldBegin(_ gesture: UIGestureRecognizer) -> Bool {
        guard gesture === pull, let page = current else { return true }
        if !strip.isHidden, strip.frame.contains(pull.location(in: view)) { return false }
        // A zoomed photo pans; at rest, a mostly vertical drag pulls.
        guard !page.isZoomed, !isClosing else { return false }
        let v = pull.velocity(in: view)
        return abs(v.y) > abs(v.x) * 1.2
    }

    @objc private func pulled(_ gesture: UIPanGestureRecognizer) {
        guard let page = current else { return }
        let t = gesture.translation(in: view)
        let progress = min(1, abs(t.y) / (view.bounds.height * 0.5))
        switch gesture.state {
        case .began:
            setChrome(hidden: true)
            pullArmed = false
            pullTap.prepare()
        case .changed:
            // The photo follows the finger and shrinks a little; the backdrop thins.
            let scale = 1 - progress * 0.3
            page.imageView.transform = CGAffineTransform(translationX: t.x, y: t.y).scaledBy(x: scale, y: scale)
            backdrop.alpha = 1 - progress * 0.9
            let armed = abs(t.y) > Self.pullThreshold
            if armed != pullArmed {
                pullArmed = armed
                pullTap.impactOccurred(intensity: armed ? 0.8 : 0.4)
            }
        case .ended, .cancelled, .failed:
            let v = gesture.velocity(in: view)
            if gesture.state == .ended && (abs(t.y) > Self.pullThreshold || abs(v.y) > 900) {
                close(velocity: v)
            } else {
                let spring = UIViewPropertyAnimator(duration: 0.4, dampingRatio: 0.82) {
                    page.imageView.transform = .identity
                    self.backdrop.alpha = 1
                }
                spring.addCompletion { _ in self.setChrome(hidden: false) }
                spring.startAnimation()
            }
        default:
            break
        }
    }

    // MARK: the morph

    /// A copy of the photo that flies between the tile and the viewer, above both.
    private func makeFlyer(_ image: UIImage?, frame: CGRect, radius: CGFloat) -> UIImageView {
        let flyer = UIImageView(image: image)
        flyer.contentMode = .scaleAspectFill
        flyer.clipsToBounds = true
        flyer.layer.cornerCurve = .continuous
        flyer.layer.cornerRadius = radius
        flyer.frame = frame
        view.addSubview(flyer)
        return flyer
    }

    private func playOpen() {
        let reduce = UIAccessibility.isReduceMotionEnabled
        guard let page = current, !reduce, let tile = MediaFrames.frame(of: items[index].id),
              let image = page.imageView.image else {
            pager.alpha = 1
            UIView.animate(withDuration: reduce ? 0.2 : 0.25) {
                self.backdrop.alpha = 1
                self.bar.alpha = 1
                self.strip.alpha = 1
            }
            if !reduce {
                pager.transform = CGAffineTransform(scaleX: 0.94, y: 0.94)
                UIView.animate(withDuration: 0.3, delay: 0, usingSpringWithDamping: 0.9, initialSpringVelocity: 0) {
                    self.pager.transform = .identity
                }
            }
            return
        }
        let target = page.convert(page.imageView.frame, to: view)
        let flyer = makeFlyer(image, frame: view.convert(tile, from: nil), radius: Self.tileRadius)
        let animator = UIViewPropertyAnimator(duration: Self.open.duration, dampingRatio: Self.open.damping) {
            flyer.frame = target
            flyer.layer.cornerRadius = 0
            self.backdrop.alpha = 1
        }
        animator.addCompletion { _ in
            self.pager.alpha = 1
            flyer.removeFromSuperview()
        }
        animator.startAnimation()
        UIView.animate(withDuration: 0.2, delay: Self.open.duration * 0.45) {
            self.bar.alpha = 1
            self.strip.alpha = 1
        }
    }

    /// Plays the exit from wherever the photo is (zoomed, or pulled away), then reports the close.
    func close(velocity: CGPoint = .zero) {
        guard !isClosing else { return }
        isClosing = true
        let reduce = UIAccessibility.isReduceMotionEnabled
        guard let page = current, !reduce, let tile = MediaFrames.frame(of: items[index].id),
              let image = page.imageView.image else {
            UIView.animate(withDuration: 0.2, animations: { self.view.alpha = 0 }) { _ in self.onClosed?() }
            return
        }
        let from = page.imageView.convert(page.imageView.bounds, to: view)
        let flyer = makeFlyer(image, frame: from, radius: 0)
        page.imageView.isHidden = true
        let to = view.convert(tile, from: nil)
        // The finger's speed carries into the flight, so a flick lands without a jolt.
        let distance = max(1, hypot(to.midX - from.midX, to.midY - from.midY))
        let speed = hypot(velocity.x, velocity.y) / distance
        let timing = UISpringTimingParameters(dampingRatio: Self.shut.damping, initialVelocity: CGVector(dx: speed, dy: speed))
        let animator = UIViewPropertyAnimator(duration: Self.shut.duration, timingParameters: timing)
        animator.addAnimations {
            flyer.frame = to
            flyer.layer.cornerRadius = Self.tileRadius
            self.backdrop.alpha = 0
            self.bar.alpha = 0
            self.strip.alpha = 0
        }
        animator.addCompletion { _ in self.onClosed?() }
        animator.startAnimation()
    }
}

/// One page: a zooming scroll view around the photo, fitted to the screen at rest.
final class LightboxPage: UIScrollView, UIScrollViewDelegate {
    let item: LightboxItem
    let imageView = UIImageView()
    private var loadingFull = false
    private var laidOutFor: CGSize = .zero

    init(item: LightboxItem) {
        self.item = item
        super.init(frame: .zero)
        delegate = self
        showsHorizontalScrollIndicator = false
        showsVerticalScrollIndicator = false
        contentInsetAdjustmentBehavior = .never
        decelerationRate = .fast
        bouncesZoom = true
        imageView.contentMode = .scaleAspectFill
        imageView.clipsToBounds = true
        imageView.isAccessibilityElement = true
        imageView.accessibilityLabel = item.name
        imageView.accessibilityTraits = .image
        addSubview(imageView)
        // What the list already decoded shows at once; the full picture replaces it.
        imageView.image = RowImages.shared.best(item.url)
    }

    required init?(coder: NSCoder) { fatalError("init(coder:)") }

    var isZoomed: Bool { zoomScale > minimumZoomScale + 0.01 }

    /// Out of reach: the full picture goes back for the tile's (or none), and loads again on return.
    func unloadFull() {
        guard loadingFull else { return }
        loadingFull = false
        if isZoomed { setZoomScale(minimumZoomScale, animated: false) }
        imageView.image = RowImages.shared.small(item.url)
    }

    /// Decodes the photo for this screen (its longest side in pixels), once.
    func loadFull() {
        guard !loadingFull else { return }
        loadingFull = true
        let screen = window?.screen ?? UIScreen.main
        let pixels = Int(max(screen.bounds.width, screen.bounds.height) * screen.scale * 1.5)
        let url = item.url
        RowImages.shared.load(url, pixels: pixels) { [weak self] image in
            // Given back meanwhile (swiped far away): it stays out.
            guard let self, self.loadingFull else { return }
            // Failed (offline): the next time the page comes near, it tries again.
            guard let image else {
                self.loadingFull = false
                return
            }
            self.setImage(image)
        }
    }

    private func setImage(_ image: UIImage) {
        let first = imageView.image == nil
        imageView.image = image
        // A bigger decode of the same picture keeps the layout; a first picture lays it out.
        if first {
            laidOutFor = .zero
            setNeedsLayout()
        }
    }

    /// The photo's aspect: from the picture, else the attachment's pixel size.
    private var aspect: CGSize {
        if let size = imageView.image?.size, size.width > 0, size.height > 0 { return size }
        if let w = item.width, let h = item.height, w > 0, h > 0 { return CGSize(width: w, height: h) }
        return CGSize(width: 4, height: 3)
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        guard bounds.width > 0, bounds.size != laidOutFor, !isZoomed else { return }
        laidOutFor = bounds.size
        let fit = min(bounds.width / aspect.width, bounds.height / aspect.height)
        let size = CGSize(width: aspect.width * fit, height: aspect.height * fit)
        zoomScale = 1
        imageView.transform = .identity
        imageView.frame = CGRect(origin: .zero, size: size)
        contentSize = size
        minimumZoomScale = 1
        // At least 3x, and up to twice the picture's own pixels when it is larger.
        let screenScale = window?.screen.scale ?? 3
        let native = max(item.width ?? 0, item.height ?? 0, Double(max(aspect.width, aspect.height)))
        maximumZoomScale = max(3, CGFloat(native) / screenScale / max(size.width, size.height) * 2)
        center()
    }

    /// Keeps a photo smaller than the page in its middle.
    private func center() {
        let dx = max(0, (bounds.width - contentSize.width) / 2)
        let dy = max(0, (bounds.height - contentSize.height) / 2)
        contentInset = UIEdgeInsets(top: dy, left: dx, bottom: dy, right: dx)
    }

    func viewForZooming(in scrollView: UIScrollView) -> UIView? { imageView }

    func scrollViewDidZoom(_ scrollView: UIScrollView) { center() }

    func resetZoom() { if isZoomed { setZoomScale(minimumZoomScale, animated: false) } }

    /// Double tap: in to 2.5x about the tapped point, or back out.
    func toggleZoom(at point: CGPoint) {
        if isZoomed {
            setZoomScale(minimumZoomScale, animated: true)
            return
        }
        let scale = min(maximumZoomScale, 2.5)
        let size = CGSize(width: bounds.width / scale, height: bounds.height / scale)
        zoom(to: CGRect(x: point.x - size.width / 2, y: point.y - size.height / 2, width: size.width, height: size.height), animated: true)
    }
}

/// Removes its notification observer when released.
final class ObserverToken: @unchecked Sendable {
    private let token: NSObjectProtocol
    init(_ token: NSObjectProtocol) { self.token = token }
    deinit { NotificationCenter.default.removeObserver(token) }
}

/// The photos as small tiles along the bottom, as in Photos: the open one lit and outlined, kept in
/// the middle as the pages turn; a tap opens that photo.
final class LightboxThumbStrip: UIView {
    static let height: CGFloat = 52
    private static let side: CGFloat = 44
    private static let gap: CGFloat = 6

    var onSelect: ((Int) -> Void)?
    private let scroll = UIScrollView()
    private var thumbs: [UIButton] = []
    private var urls: [String] = []
    private var selected = 0
    private var arrival: ObserverToken?

    override init(frame: CGRect) {
        super.init(frame: frame)
        scroll.showsHorizontalScrollIndicator = false
        scroll.alwaysBounceHorizontal = true
        scroll.decelerationRate = .fast
        addSubview(scroll)
        // A thumbnail that was still loading shows once its picture arrives.
        arrival = ObserverToken(NotificationCenter.default.addObserver(forName: RowImages.loaded, object: nil, queue: .main) { [weak self] note in
            let url = note.object as? String
            MainActor.assumeIsolated { self?.refresh(url) }
        })
    }

    required init?(coder: NSCoder) { fatalError("init(coder:)") }

    func set(items: [LightboxItem], selected: Int) {
        thumbs.forEach { $0.removeFromSuperview() }
        urls = items.map(\.url)
        thumbs = items.enumerated().map { i, item in
            let thumb = UIButton(type: .custom)
            thumb.imageView?.contentMode = .scaleAspectFill
            thumb.contentHorizontalAlignment = .fill
            thumb.contentVerticalAlignment = .fill
            thumb.clipsToBounds = true
            thumb.layer.cornerRadius = 8
            thumb.layer.cornerCurve = .continuous
            thumb.backgroundColor = UIColor(white: 1, alpha: 0.12)
            thumb.accessibilityLabel = "\(item.name), \(i + 1) of \(items.count)"
            thumb.tag = i
            thumb.addTarget(self, action: #selector(pressed(_:)), for: .touchUpInside)
            scroll.addSubview(thumb)
            return thumb
        }
        for i in urls.indices { refreshThumb(i) }
        self.selected = selected
        setNeedsLayout()
        layoutIfNeeded()
        select(selected, animated: false)
    }

    private func refresh(_ url: String?) {
        for (i, each) in urls.enumerated() where each == url { refreshThumb(i) }
    }

    private func refreshThumb(_ i: Int) {
        guard thumbs[i].image(for: .normal) == nil else { return }
        let pixels = Int(Self.side * (window?.screen.scale ?? 3))
        if let image = RowImages.shared.image(urls[i], pixels: pixels) ?? RowImages.shared.best(urls[i]) {
            thumbs[i].setImage(image, for: .normal)
        }
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        scroll.frame = bounds
        let total = CGFloat(thumbs.count) * Self.side + CGFloat(max(0, thumbs.count - 1)) * Self.gap
        // Few enough to fit: centred; more: they scroll, and the ends can still reach the middle.
        let pad = max(16, (bounds.width - total) / 2)
        for (i, thumb) in thumbs.enumerated() {
            thumb.frame = CGRect(x: pad + CGFloat(i) * (Self.side + Self.gap), y: (bounds.height - Self.side) / 2, width: Self.side, height: Self.side)
        }
        scroll.contentSize = CGSize(width: total + pad * 2, height: bounds.height)
        style()
    }

    func select(_ i: Int, animated: Bool) {
        guard thumbs.indices.contains(i) else { return }
        selected = i
        let center = thumbs[i].frame.midX - scroll.bounds.width / 2
        let x = min(max(0, center), max(0, scroll.contentSize.width - scroll.bounds.width))
        if animated {
            UIView.animate(withDuration: 0.25, delay: 0, options: [.curveEaseOut, .allowUserInteraction]) {
                self.scroll.contentOffset.x = x
                self.style()
            }
        } else {
            scroll.contentOffset.x = x
            style()
        }
    }

    private func style() {
        for (i, thumb) in thumbs.enumerated() {
            let on = i == selected
            thumb.alpha = on ? 1 : 0.5
            thumb.transform = on ? CGAffineTransform(scaleX: 1.08, y: 1.08) : .identity
            thumb.layer.borderWidth = on ? 2 : 0
            thumb.layer.borderColor = UIColor.white.cgColor
            thumb.accessibilityTraits = on ? [.button, .selected] : .button
        }
    }

    @objc private func pressed(_ sender: UIButton) {
        guard sender.tag != selected else { return }
        // The viewer ticks once for the jump (`go`).
        onSelect?(sender.tag)
    }
}
