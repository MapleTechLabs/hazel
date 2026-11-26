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

/// The icons a structure view draws itself (not an `hz:icon` node): a web icon name as an SF Symbol.
/// Stand-in until lane S1's icon catalog is shared; the names are `options.ts` `iconNames`.
enum StructureIcon {
    static func image(_ name: String) -> Image {
        Image(systemName: symbols[name] ?? "circle")
    }

    private static let symbols: [String: String] = [
        "arrow-up": "arrow.up", "bell": "bell", "check": "checkmark", "chevron-down": "chevron.down",
        "chevron-right": "chevron.right", "close": "xmark", "copy": "doc.on.doc", "dots": "ellipsis",
        "download": "arrow.down.to.line", "edit": "pencil", "emoji": "face.smiling",
        "emoji-add": "face.smiling", "gear": "gearshape", "gif": "photo", "hashtag": "number",
        "leave": "rectangle.portrait.and.arrow.right", "lightbulb": "lightbulb", "lock": "lock",
        "office": "building.2", "paperclip": "paperclip", "pin": "pin", "plus": "plus",
        "reply": "arrowshape.turn.up.left", "search": "magnifyingglass", "share": "square.and.arrow.up",
        "sparkles": "sparkles", "star": "star", "thread": "bubble.left.and.bubble.right", "trash": "trash",
        "users": "person.2", "volume-mute": "speaker.slash", "warning": "exclamationmark.triangle",
        "slack": "number.square", "discord": "gamecontroller",
    ]
}
