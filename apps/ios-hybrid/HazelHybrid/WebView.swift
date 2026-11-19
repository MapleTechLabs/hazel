import ObjectiveC
import SwiftUI
import UIKit
import WebKit

/// A place the bridge's one web view can be. The web view must stay in the window at all times:
/// WebKit stops animation frames for a web view outside it, and the page (Foldkit renders on
/// animation frames) would stop drawing, also the screens the shell draws natively from it.
/// The root keeps a slot behind its native screen; a pushed page takes the view into its own slot,
/// and the root's slot takes it back when the page is popped.
struct WebSlot: UIViewRepresentable {
    let bridge: WebBridge
    /// This slot should hold the web view now.
    let isActive: Bool

    func makeUIView(context: Context) -> SlotView {
        let slot = SlotView()
        slot.backgroundColor = .clear
        take(into: slot)
        return slot
    }

    func updateUIView(_ slot: SlotView, context: Context) { take(into: slot) }

    private func take(into slot: SlotView) {
        let webView = bridge.webView
        guard isActive, webView.superview !== slot else { return }
        // The slot it leaves (the page under a pushed one) keeps a picture of it: the page under
        // stays drawn while the one over it slides in or is swiped away.
        (webView.superview as? SlotView)?.keepPicture(of: webView)
        webView.removeFromSuperview()
        slot.dropPicture()
        slot.addSubview(webView)
        slot.setNeedsLayout()
    }
}

/// Holds the web view, sized to the part of the slot the keyboard leaves free. The page is one
/// screen high and lays itself out for the keyboard (its composer sits on it), as Safari does with
/// `interactive-widget=resizes-content`; WebKit's own answer, scrolling the whole page up under the
/// status bar, is held off.
final class SlotView: UIView {
    private var keyboardOverlap: CGFloat = 0
    private var picture: UIView?

    func keepPicture(of webView: UIView) {
        dropPicture()
        guard let picture = webView.snapshotView(afterScreenUpdates: false) else { return }
        picture.frame = webView.frame
        addSubview(picture)
        self.picture = picture
    }

    func dropPicture() {
        picture?.removeFromSuperview()
        picture = nil
    }

    override init(frame: CGRect) {
        super.init(frame: frame)
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(keyboardWillChange(_:)),
            name: UIResponder.keyboardWillChangeFrameNotification,
            object: nil
        )
    }

    required init?(coder: NSCoder) { fatalError("init(coder:)") }

    private static func holdsFirstResponder(_ view: UIView) -> Bool {
        view.isFirstResponder || view.subviews.contains { holdsFirstResponder($0) }
    }

    override func layoutSubviews() {
        super.layoutSubviews()
        for webView in subviews {
            webView.frame = CGRect(x: 0, y: 0, width: bounds.width, height: bounds.height - keyboardOverlap)
        }
    }

    @objc private func keyboardWillChange(_ notification: Notification) {
        guard let window, let info = notification.userInfo,
              let end = (info[UIResponder.keyboardFrameEndUserInfoKey] as? NSValue)?.cgRectValue
        else { return }
        let mine = convert(bounds, to: window)
        // Only the page's own fields resize it: a native field's keyboard (the composer) leaves the
        // page as it is, so WebKit never makes the shell wait on a page layout.
        let isPages = subviews.contains { Self.holdsFirstResponder($0) }
        keyboardOverlap = isPages ? max(0, mine.maxY - end.minY) : 0
        let duration = info[UIResponder.keyboardAnimationDurationUserInfoKey] as? Double ?? 0.25
        let curve = info[UIResponder.keyboardAnimationCurveUserInfoKey] as? UInt ?? 7
        UIView.animate(
            withDuration: duration,
            delay: 0,
            options: UIView.AnimationOptions(rawValue: curve << 16),
            animations: { self.layoutSubviews() }
        )
    }
}

extension WKWebView {
    /// The page never scrolls as a whole (its lists scroll inside it): WebKit's scroll to reveal a
    /// focused field is put back at once.
    func pinPageScroll() -> NSKeyValueObservation {
        scrollView.observe(\.contentOffset, options: [.new]) { scrollView, _ in
            if scrollView.contentOffset != .zero { scrollView.contentOffset = .zero }
        }
    }

    /// No form accessory bar (previous, next, done) over the keyboard: a native app has none.
    func hideInputAccessory() {
        guard let content = scrollView.subviews.first(where: { String(describing: type(of: $0)).hasPrefix("WKContent") }),
              let base = object_getClass(content)
        else { return }
        let name = "\(NSStringFromClass(base))_HazelNoAccessory"
        var subclass: AnyClass? = NSClassFromString(name)
        if subclass == nil, let made = objc_allocateClassPair(base, name, 0) {
            let none: @convention(block) (AnyObject) -> AnyObject? = { _ in nil }
            class_addMethod(
                made,
                #selector(getter: UIResponder.inputAccessoryView),
                imp_implementationWithBlock(none),
                "@@:"
            )
            objc_registerClassPair(made)
            subclass = made
        }
        if let subclass { object_setClass(content, subclass) }
    }
}

/// The system's swipe back on a page whose navigation bar is hidden (its own header is the bar):
/// UIKit turns the pop gesture off with the bar; it starts again whenever there is a page to pop.
extension UINavigationController: @retroactive UIGestureRecognizerDelegate {
    override open func viewDidLoad() {
        super.viewDidLoad()
        interactivePopGestureRecognizer?.delegate = self
        interactiveContentPopGestureRecognizer?.delegate = self
    }

    /// SwiftUI turns the gesture off again whenever it hides the bar.
    override open func viewDidLayoutSubviews() {
        super.viewDidLayoutSubviews()
        interactivePopGestureRecognizer?.isEnabled = true
        // iOS 26's swipe back from anywhere on the page, off with the bar too.
        interactiveContentPopGestureRecognizer?.isEnabled = true
    }

    public func gestureRecognizerShouldBegin(_ gestureRecognizer: UIGestureRecognizer) -> Bool {
        guard viewControllers.count > 1 else { return false }
        // Going back puts the keyboard away as the page starts to leave.
        view.endEditing(true)
        return true
    }

    /// Alongside the page's own touches (its lists scroll vertically; the pop is a horizontal edge pan).
    public func gestureRecognizer(
        _ gestureRecognizer: UIGestureRecognizer,
        shouldRecognizeSimultaneouslyWith other: UIGestureRecognizer
    ) -> Bool {
        gestureRecognizer === interactivePopGestureRecognizer || gestureRecognizer === interactiveContentPopGestureRecognizer
    }
}
