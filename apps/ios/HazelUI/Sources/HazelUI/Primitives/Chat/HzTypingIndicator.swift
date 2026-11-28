import SwiftUI
import UIKit

/// `hz:typingIndicator` (lane S5): three bouncing dots and who is typing (`page/chat/banners.ts`).
/// Nothing while nobody types; a new line is announced, as the web's polite live region is.
struct HzTypingIndicator: View {
    let tree: Tree
    let node: Node
    @Environment(\.horizontalSizeClass) private var sizeClass

    var body: some View {
        let sc = HazelTheme.SizeClass(sizeClass)
        let recipe = HazelTheme.Recipes.typingIndicator
        let root = recipe.style(sizeClass: sc)
        let dots = recipe.style(part: "dots", sizeClass: sc)
        let dot = recipe.style(part: "dot", sizeClass: sc)
        let label = Self.text((node[prop: "names"]?.array ?? []).compactMap(\.string))
        if !label.isEmpty {
            HStack(spacing: root.gap ?? 0) {
                TypingDots(size: dot.size ?? 6, gap: dots.gap ?? 4, color: dot.background ?? HazelTheme.Colors.mutedFg)
                    .frame(width: (dot.size ?? 6) * 3 + (dots.gap ?? 4) * 2, height: dot.size ?? 6)
                    .accessibilityHidden(true)
                Text(label).hzText(root, sc)
            }
            .frame(minHeight: root.minHeight)
            .accessibilityElement(children: .combine)
            .accessibilityAddTraits(.updatesFrequently)
            .onChange(of: label, initial: true) { _, now in
                UIAccessibility.post(notification: .announcement, argument: now)
            }
        }
    }

    /// "Ada is typing...", "Ada and Grace are typing...", "Ada and 2 others are typing..." (`typingText`).
    static func text(_ names: [String]) -> String {
        switch names.count {
        case 0: ""
        case 1: "\(names[0]) is typing..."
        case 2: "\(names[0]) and \(names[1]) are typing..."
        default: "\(names[0]) and \(names.count - 1) others are typing..."
        }
    }
}

/// The dots, bounced by Core Animation with the recipe's loop (`bounce` on `dot`), so the bounce costs no
/// SwiftUI updates; it does not run under Reduce Motion.
private struct TypingDots: UIViewRepresentable {
    let size: CGFloat
    let gap: CGFloat
    let color: HazelTheme.ThemedColor

    func makeUIView(context: Context) -> DotsView { DotsView() }

    func updateUIView(_ view: DotsView, context: Context) {
        let reduce = HazelMotion.reduced(context.environment.accessibilityReduceMotion)
        view.configure(size: size, gap: gap, color: color, dark: context.environment.colorScheme == .dark, reduce: reduce)
    }

    final class DotsView: UIView {
        private var dots: [CALayer] = []
        /// The web renderer's stagger (`chat/styles.ts`: -0.3s, -0.15s, 0), not in the contract yet
        /// (GAPS `motion-stagger`).
        private static let stagger: [Double] = [0.3, 0.15, 0]

        func configure(size: CGFloat, gap: CGFloat, color: HazelTheme.ThemedColor, dark: Bool, reduce: Bool) {
            if dots.isEmpty {
                for _ in 0..<3 {
                    let dot = CALayer()
                    layer.addSublayer(dot)
                    dots.append(dot)
                }
            }
            let spec = HazelMotion.spec("typingIndicator", .loop, part: "dot")
            let timeline = HazelMotion.enabled ? spec.flatMap { MotionTimeline($0, reduceMotion: reduce) } : nil
            for (i, dot) in dots.enumerated() {
                dot.frame = CGRect(x: CGFloat(i) * (size + gap), y: 0, width: size, height: size)
                dot.cornerRadius = size / 2
                dot.backgroundColor = color.ui(dark).cgColor
                guard let timeline else { dot.removeAllAnimations(); continue }
                guard dot.animation(forKey: "bounce") == nil else { continue }
                let bounce = timeline.layerAnimation(size: dot.bounds.size)
                bounce.beginTime = CACurrentMediaTime() - Self.stagger[i]
                dot.add(bounce, forKey: "bounce")
            }
        }
    }
}
