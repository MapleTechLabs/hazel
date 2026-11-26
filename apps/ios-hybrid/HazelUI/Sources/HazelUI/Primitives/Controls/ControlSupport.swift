import SwiftUI
import UIKit

// Owned by lane S2. What the controls share beyond `Tree/Styling.swift`: the recipe's border and
// shadows (which `hzBox` leaves out), the monospaced step, the catalog icon, and recipe lookups.

extension HazelTheme.Recipe {
    /// The root and one part in one call, for a control's current options, flags and states.
    func styles(
        _ parts: [String], options: [String: String] = [:], flags: Set<String> = [],
        states: Set<HazelTheme.State> = [], sizeClass: HazelTheme.SizeClass
    ) -> [String: HazelTheme.Style] {
        var out = ["": style(options: options, flags: flags, states: states, sizeClass: sizeClass)]
        for part in parts {
            out[part] = style(part: part, options: options, flags: flags, states: states, sizeClass: sizeClass)
        }
        return out
    }
}

extension HazelTheme.Style {
    /// `font(_:)`, except the theme's monospaced step (`Font.monoStep`) draws in the system monospace,
    /// as the web's `font.mono` stack does.
    func controlFont(_ sizeClass: HazelTheme.SizeClass) -> SwiftUI.Font {
        guard (text ?? .body) == HazelTheme.Font.monoStep else { return font(sizeClass) }
        let size = HazelTheme.text(HazelTheme.Font.monoStep, sizeClass).size
        return .system(size: size, weight: strong == true ? .medium : .regular, design: .monospaced)
    }

    /// The extra space between lines that makes a multi-line field's lines the step's line height.
    func lineSpacing(_ sizeClass: HazelTheme.SizeClass) -> CGFloat {
        let metrics = HazelTheme.text(text ?? .body, sizeClass)
        let weight = strong == true ? HazelTheme.Font.weightStrong : HazelTheme.Font.weightRegular
        let natural = UIFont(name: weight >= 500 ? "Inter-Medium" : "Inter-Regular", size: metrics.size)?.lineHeight
            ?? UIFont.systemFont(ofSize: metrics.size).lineHeight
        return max(0, lineHeight(sizeClass) - natural)
    }

    var shape: RoundedRectangle { RoundedRectangle(cornerRadius: min(radius ?? 0, 1000), style: .continuous) }
}

extension View {
    /// `hzBox` plus the border (inside the box, as CSS `border-box`) and the recipe's shadow, then the
    /// opacity over all of it.
    func hzControlBox(_ style: HazelTheme.Style, _ scheme: ColorScheme) -> some View {
        var inner = style
        inner.opacity = nil
        let width = style.borderWidth ?? 0
        return padding(width)
            .hzBox(inner)
            .overlay {
                if width > 0, let color = style.borderColor { style.shape.strokeBorder(color.color, lineWidth: width) }
            }
            .hzShadow(style.shadow, style.shape, scheme)
            .opacity(style.opacity ?? 1)
    }

    /// A shadow token (`HazelTheme.shadows`): outer shadows behind the box, masked off its inside so a
    /// clear box shows none through it; inset ones as the band an unblurred offset leaves inside.
    @ViewBuilder func hzShadow(_ name: String?, _ shape: RoundedRectangle, _ scheme: ColorScheme) -> some View {
        if let name, let set = HazelTheme.shadows[name] {
            let layers = scheme == .dark ? set.dark : set.light
            background {
                ZStack {
                    ForEach(Array(layers.enumerated()).filter { !$0.element.inset }, id: \.offset) { _, s in
                        shape.inset(by: -s.spread).fill(Color.black)
                            .shadow(color: Color(uiColor: s.color.uiColor), radius: s.blur / 2, x: s.x, y: s.y)
                    }
                }
                .mask { Rectangle().inset(by: -64).subtracting(shape).fill(style: FillStyle(eoFill: false)) }
                .allowsHitTesting(false)
            }
            .overlay {
                ForEach(Array(layers.enumerated()).filter { $0.element.inset }, id: \.offset) { _, s in
                    shape.subtracting(shape.offset(x: s.x, y: s.y)).fill(Color(uiColor: s.color.uiColor))
                }
                .allowsHitTesting(false)
            }
        } else {
            self
        }
    }

    /// The web's focus outline on a text control: 2pt of `ring` at 70%, just outside the box.
    func hzFocusRing(_ on: Bool, _ shape: RoundedRectangle) -> some View {
        overlay {
            if on { shape.inset(by: -2).strokeBorder(HazelTheme.Colors.ring.color.opacity(0.7), lineWidth: 2) }
        }
    }
}

/// An icon by vocabulary name (`IconName`) from the shared catalog (`HazelIcon`), in a part's ink.
struct ControlIcon: View {
    let name: String
    let size: CGFloat
    let color: Color

    var body: some View {
        HazelIcon(name: name, size: size).foregroundStyle(color)
    }
}

extension Node {
    func string(_ key: String) -> String? { props[key]?.string }
    func flag(_ key: String) -> Bool { props[key]?.bool == true }
}

/// The recipe's transition as an animation, or none under Reduce Motion.
func controlAnimation(_ seconds: Double?, reduceMotion: Bool) -> Animation? {
    guard let seconds, !reduceMotion, let (a, b, c, d) = HazelTheme.easing["out"] else { return nil }
    return .timingCurve(a, b, c, d, duration: seconds)
}
