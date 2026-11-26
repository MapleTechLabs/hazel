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

/// The dots, bounced by Core Animation (`hz-typing-bounce`: a quarter of a dot up and back each second,
/// staggered), so the bounce costs no SwiftUI updates and stops under Reduce Motion.
private struct TypingDots: UIViewRepresentable {
    let size: CGFloat
    let gap: CGFloat
    let color: HazelTheme.ThemedColor

    func makeUIView(context: Context) -> DotsView { DotsView() }

    func updateUIView(_ view: DotsView, context: Context) {
        view.configure(size: size, gap: gap, color: color, dark: context.environment.colorScheme == .dark)
    }

    final class DotsView: UIView {
        private var dots: [CALayer] = []

        func configure(size: CGFloat, gap: CGFloat, color: HazelTheme.ThemedColor, dark: Bool) {
            if dots.isEmpty {
                for _ in 0..<3 {
                    let dot = CALayer()
                    layer.addSublayer(dot)
                    dots.append(dot)
                }
            }
            let reduce = UIAccessibility.isReduceMotionEnabled
            for (i, dot) in dots.enumerated() {
                dot.frame = CGRect(x: CGFloat(i) * (size + gap), y: 0, width: size, height: size)
                dot.cornerRadius = size / 2
                dot.backgroundColor = color.ui(dark).cgColor
                if reduce { dot.removeAllAnimations(); continue }
                guard dot.animation(forKey: "bounce") == nil else { continue }
                let bounce = CAKeyframeAnimation(keyPath: "transform.translation.y")
                bounce.values = [-size / 4, 0, -size / 4]
                bounce.keyTimes = [0, 0.5, 1]
                bounce.timingFunctions = [CAMediaTimingFunction(controlPoints: 0, 0, 0.2, 1), CAMediaTimingFunction(controlPoints: 0.8, 0, 1, 1)]
                bounce.duration = 1
                bounce.repeatCount = .infinity
                bounce.beginTime = CACurrentMediaTime() - [0.3, 0.15, 0][i]
                dot.add(bounce, forKey: "bounce")
            }
        }
    }
}
