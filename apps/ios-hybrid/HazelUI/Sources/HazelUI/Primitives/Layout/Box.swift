import SwiftUI

// What lane S1's boxes need beyond `hzBox` (Tree/Styling.swift): a recipe's border and shadow, and
// whether a block fills its container's width (a CSS block does; a flex item in a row does not).

extension EnvironmentValues {
    /// True inside a horizontal stack or scroll: blocks there size to their content, as flex items do.
    @Entry var hzInRow = false
    /// The size an `hz:icon` draws at when its container sets one (a part's recipe `size`).
    @Entry var hzIconSize: CGFloat? = nil
}

extension Node {
    /// The recipe options among `keys` this node sets (an unset option takes the recipe's default).
    func options(_ keys: [String]) -> [String: String] {
        keys.reduce(into: [:]) { out, key in
            if let value = self[prop: key]?.string { out[key] = value }
        }
    }
}

extension View {
    /// A style's border (`borderColor`, `borderWidth`) inside its corner radius, as CSS draws it.
    @ViewBuilder func hzBorder(_ style: HazelTheme.Style) -> some View {
        if let color = style.borderColor, let width = style.borderWidth, width > 0 {
            overlay {
                RoundedRectangle(cornerRadius: min(style.radius ?? 0, 1000), style: .continuous)
                    .strokeBorder(color.color, lineWidth: width)
            }
        } else {
            self
        }
    }

    /// A style's named shadow (`HazelTheme.shadows`), cast by its background shape; inset layers are skipped.
    func hzShadow(_ style: HazelTheme.Style) -> some View {
        modifier(ShadowModifier(name: style.shadow, radius: style.radius ?? 0, background: style.background))
    }

    /// Full width with leading content, when `on` (a block in a column).
    @ViewBuilder func hzFillWidth(_ on: Bool, alignment: Alignment = .leading) -> some View {
        if on { frame(maxWidth: .infinity, alignment: alignment) } else { self }
    }
}

private struct ShadowModifier: ViewModifier {
    let name: String?
    let radius: CGFloat
    let background: HazelTheme.ThemedColor?
    @Environment(\.colorScheme) private var scheme

    func body(content: Content) -> some View {
        let layers = name.flatMap { HazelTheme.shadows[$0] }.map { scheme == .dark ? $0.dark : $0.light } ?? []
        let outer = layers.filter { !$0.inset }
        content.background {
            ZStack {
                ForEach(outer.indices, id: \.self) { index in
                    let s = outer[index]
                    RoundedRectangle(cornerRadius: min(radius, 1000), style: .continuous)
                        .fill(background?.color ?? .clear)
                        .padding(-s.spread)
                        .shadow(color: Color(uiColor: s.color.uiColor), radius: s.blur / 2, x: s.x, y: s.y)
                }
            }
        }
    }
}
