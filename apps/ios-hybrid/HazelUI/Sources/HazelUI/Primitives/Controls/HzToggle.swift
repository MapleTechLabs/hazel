import SwiftUI

// Owned by lane S2. `hz:toggle`: a SwiftUI `Toggle` (switch semantics, label and description read
// together) drawn from the toggle recipe. Controlled: a flip raises `change {checked}` and the switch
// moves when the Model sends `checked`.
struct HzToggle: View {
    let tree: Tree
    let node: Node
    @Environment(\.horizontalSizeClass) private var horizontalSizeClass
    @Environment(\.colorScheme) private var scheme
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        let checked = node.flag("checked")
        Toggle(isOn: Binding(get: { checked }, set: { tree.fire(node.id, "change", ["checked": .bool($0)]) })) {
            Text(node.string("label") ?? "")
            if let description = node.string("description") { Text(description) }
        }
        .toggleStyle(ToggleFace(
            label: node.string("label") ?? "", description: node.string("description"),
            sizeClass: HazelTheme.SizeClass(horizontalSizeClass), scheme: scheme, reduceMotion: reduceMotion))
        .disabled(node.flag("disabled"))
    }
}

/// The recipe's row: label and description, then the track. Track width and thumb travel are the web
/// renderer's own (`controls/styles.ts`): `space-10`/`space-4` compact, `space-8`/`space-3` regular.
private struct ToggleFace: ToggleStyle {
    let label: String
    let description: String?
    let sizeClass: HazelTheme.SizeClass
    let scheme: ColorScheme
    let reduceMotion: Bool
    @Environment(\.isEnabled) private var isEnabled

    func makeBody(configuration: Configuration) -> some View {
        var states: Set<HazelTheme.State> = configuration.isOn ? [.selected] : []
        if !isEnabled { states.insert(.disabled) }
        let s = HazelTheme.Recipes.toggle.styles(
            ["text", "label", "description", "control", "thumb"], states: states, sizeClass: sizeClass)
        let root = s[""]!, text = s["text"]!, trackStyle = s["control"]!, thumb = s["thumb"]!
        let compact = sizeClass == .compact
        let width = HazelTheme.space[compact ? "10" : "8"] ?? 40
        let travel = HazelTheme.space[compact ? "4" : "3"] ?? 16

        return HStack(alignment: .top, spacing: root.gap ?? 0) {
            words(text, s["label"]!, s["description"]!)
            track(on: configuration.isOn, track: trackStyle, thumb: thumb, width: width, travel: travel)
        }
        .frame(maxWidth: root.fill == true ? .infinity : nil, alignment: .leading)
        .contentShape(Rectangle())
        .onTapGesture { if isEnabled { configuration.isOn.toggle() } }
        .opacity(root.opacity ?? 1)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(label)
        .accessibilityHint(description ?? "")
        .accessibilityValue(configuration.isOn ? "On" : "Off")
        .accessibilityAddTraits(.isToggle)
        .accessibilityAction { if isEnabled { configuration.isOn.toggle() } }
    }

    private func words(
        _ text: HazelTheme.Style, _ labelStyle: HazelTheme.Style, _ descriptionStyle: HazelTheme.Style
    ) -> some View {
        VStack(alignment: .leading, spacing: text.gap ?? 0) {
            Text(label).hzText(labelStyle, sizeClass)
            if let description {
                Text(description).hzText(descriptionStyle, sizeClass).fixedSize(horizontal: false, vertical: true)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func track(
        on: Bool, track: HazelTheme.Style, thumb: HazelTheme.Style, width: CGFloat, travel: CGFloat
    ) -> some View {
        let knob = thumb.size ?? 18, inset = track.paddingX ?? 0
        let face = thumb.shape.fill(thumb.background?.color ?? .white)
            .frame(width: knob, height: knob)
            .hzShadow(thumb.shadow, thumb.shape, scheme)
            .offset(x: on ? travel : 0)
        return face
            .frame(width: width - 2 * inset, alignment: .leading)
            .padding(.horizontal, inset)
            .padding(.vertical, track.paddingY ?? 0)
            .background(track.shape.fill(track.background?.color ?? .clear))
            .animation(controlAnimation(track, reduceMotion: reduceMotion), value: on)
    }
}
