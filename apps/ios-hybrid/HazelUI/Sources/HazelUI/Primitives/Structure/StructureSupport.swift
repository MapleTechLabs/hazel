import SwiftUI
import UIKit

// Lane S4's shared pieces: a press-aware button style, the scroll proxy a screen hands its rows, and
// the icons the structure views draw themselves (chevrons, tab icons).

/// A button whose look is drawn from its pressed state, so a recipe's `pressed` layer applies.
struct PressStyle<Content: View>: ButtonStyle {
    let content: (_ pressed: Bool) -> Content

    func makeBody(configuration: Configuration) -> some View { content(configuration.isPressed) }
}

extension EnvironmentValues {
    /// The scroll view a screen lays its content in, for `item.scrollTo`.
    @Entry var hzScrollProxy: ScrollViewProxy? = nil
    /// Set inside `navigation` and `splitView`: a screen there uses the system navigation bar.
    @Entry var hzNavigationBar: Bool = false
    /// Set on a collapsible section's header actions: today's round, muted "+" (`sectionPlusButton`).
    @Entry var hzRoundAction: Bool = false
}

extension View {
    /// A full-screen container (`navigation`, `tabBar`, `splitView`) is ideally the screen's height.
    /// It shows only where a host lets content size itself (snapshots, a fitting sheet).
    func hzScreenIdealHeight() -> some View {
        // A test runner may have no window scene; the main screen still has the device's size.
        let scene = UIApplication.shared.connectedScenes.compactMap { $0 as? UIWindowScene }.first
        return frame(idealHeight: (scene?.screen ?? UIScreen.main).bounds.height)
    }
}

/// The recipe's interaction states for a press and a pointer hover.
func interactionStates(pressed: Bool, hovering: Bool) -> Set<HazelTheme.State> {
    var states: Set<HazelTheme.State> = []
    if pressed { states.insert(.pressed) }
    if hovering { states.insert(.hover) }
    return states
}

/// The icons a structure view draws itself (not an `hz:icon` node), from S1's catalog (`native-icon-image`):
/// at the icon grid's own size, so system bars and menus size it as they size a symbol.
enum StructureIcon {
    static func image(_ name: String) -> Image {
        guard let image = HazelIcons.uiImage(name) else { return Image(uiImage: UIImage()) }
        return Image(uiImage: image).renderingMode(HazelIcons.isTemplate(image) ? .template : .original)
    }
}
