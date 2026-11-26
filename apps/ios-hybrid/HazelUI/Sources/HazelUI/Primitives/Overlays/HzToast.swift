import SwiftUI
import UIKit

// `hz:toast` on iOS (lane S3): a transient notice at the bottom edge, in its own pass-through window
// above the app's sheets; open toasts stack upwards, newest at the bottom. VoiceOver announces it. Its
// close button raises `dismiss` (the view's timer closes it too). In place it draws the panel.
struct HzToast: View {
    let tree: Tree
    let node: Node

    var body: some View {
        let open = node[prop: "open"]?.bool == true
        if node.overlayInPlace {
            if open { ToastPanel(tree: tree, node: node) }
        } else {
            Color.clear.frame(width: 0, height: 0)
                .onChange(of: open, initial: true) { _, open in
                    if open { ToastWindow.shared.show(tree, node) } else { ToastWindow.shared.hide(tree, node.id) }
                }
                .onDisappear { ToastWindow.shared.hide(tree, node.id) }
        }
    }
}

/// The toast's panel: title and description, the `action` slot, and the dismiss button.
struct ToastPanel: View {
    let tree: Tree
    let node: Node
    @Environment(\.horizontalSizeClass) private var horizontal

    var body: some View {
        let sizeClass = HazelTheme.SizeClass(horizontal)
        let recipe = HazelTheme.Recipes.toast
        let options = node[prop: "tone"]?.string.map { ["tone": $0] } ?? [:]
        let panel = recipe.style(part: "panel", sizeClass: sizeClass)
        let body = recipe.style(part: "body", sizeClass: sizeClass)
        let content = recipe.style(part: "content", sizeClass: sizeClass)
        HStack(alignment: .top, spacing: panel.gap ?? 0) {
            VStack(alignment: .leading, spacing: body.rowGap ?? 0) {
                if let title = node.overlayText("title") {
                    Text(title).hzText(recipe.style(part: "title", options: options, sizeClass: sizeClass), sizeClass)
                }
                if let description = node.overlayText("description") {
                    Text(description).hzText(recipe.style(part: "description", sizeClass: sizeClass), sizeClass)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            if tree.slot("action", of: node) != nil {
                HStack(spacing: content.gap ?? 0) { SlotView(tree: tree, node: node, name: "action") }
            }
            OverlayCloseButton(style: recipe.style(part: "close", sizeClass: sizeClass), label: "Dismiss") {
                tree.fire(node.id, "dismiss")
            }
        }
        .hzOverlayPanel(panel)
        .accessibilityElement(children: .contain)
    }
}

/// The one window toasts float in: above the app's own (and its sheets), passing every touch
/// outside a toast through to the app.
@MainActor
final class ToastWindow {
    static let shared = ToastWindow()

    struct Entry: Identifiable {
        let tree: Tree
        let node: Node
        var id: NodeId { node.id }
    }

    @Observable @MainActor final class Model {
        var toasts: [Entry] = []
        /// Where the stack is, in the window: only these points take touches.
        @ObservationIgnored var frame: CGRect = .zero
    }

    let model = Model()
    private var window: PassThroughWindow?

    func show(_ tree: Tree, _ node: Node) {
        guard !model.toasts.contains(where: { $0.node.id == node.id && $0.tree === tree }) else { return }
        model.toasts.append(Entry(tree: tree, node: node))
        attach()
        if let title = node.overlayText("title") {
            UIAccessibility.post(notification: .announcement, argument: title)
        }
    }

    func hide(_ tree: Tree, _ id: NodeId) {
        model.toasts.removeAll { $0.node.id == id && $0.tree === tree }
        if model.toasts.isEmpty {
            window?.isHidden = true
            window = nil
        }
    }

    var isShowing: Bool { window != nil && !model.toasts.isEmpty }

    private func attach() {
        guard window == nil else { return }
        let scenes = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }
        let scene = scenes.first(where: { $0.activationState == .foregroundActive }) ?? scenes.first
        // No scene (a package test runner): a window of the screen's size.
        let window = scene.map { PassThroughWindow(windowScene: $0) } ?? PassThroughWindow(frame: UIScreen.main.bounds)
        window.model = model
        window.windowLevel = .alert
        let host = UIHostingController(rootView: ToastStack(model: model))
        host.view.backgroundColor = .clear
        window.rootViewController = host
        if let style = scene?.windows.first(where: \.isKeyWindow)?.traitCollection.userInterfaceStyle {
            window.overrideUserInterfaceStyle = style
        }
        window.isHidden = false
        self.window = window
    }
}

private final class PassThroughWindow: UIWindow {
    weak var model: ToastWindow.Model?

    override func point(inside point: CGPoint, with event: UIEvent?) -> Bool {
        model?.frame.contains(point) ?? false
    }
}

/// Open toasts from the bottom edge up, at the toast's width in the regular size class.
private struct ToastStack: View {
    let model: ToastWindow.Model
    @Environment(\.horizontalSizeClass) private var horizontal
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    /// The web's renderer-owned 22rem (`focus/surface.ts`) for a wide screen.
    private static let regularWidth: CGFloat = 352

    var body: some View {
        let inset = HazelTheme.space["4"] ?? 0
        VStack(spacing: HazelTheme.space["2"] ?? 0) {
            ForEach(model.toasts) { toast in
                ToastPanel(tree: toast.tree, node: toast.node)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .frame(maxWidth: horizontal == .regular ? Self.regularWidth : .infinity)
        .onGeometryChange(for: CGRect.self) { $0.frame(in: .global) } action: { model.frame = $0 }
        .padding(inset)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: horizontal == .regular ? .bottomTrailing : .bottom)
        .animation(reduceMotion ? nil : .easeOut(duration: HazelTheme.duration["fast"] ?? 0), value: model.toasts.map(\.id))
    }
}
