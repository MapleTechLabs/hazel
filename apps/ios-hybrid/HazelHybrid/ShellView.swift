import SwiftUI

/// The app: a native navigation stack driven by what the page shows.
///
/// - A converted screen (the page reports semantic nodes) is drawn natively at the root.
/// - An unconverted page with the tab bar (Activity, Settings) is the web view, at the root.
/// - An unconverted page without it (a conversation) is pushed over the last native screen: the
///   system's back button and interactive swipe pop it, and the page follows (its own back link).
struct ShellView: View {
    @State private var bridge = WebBridge()
    @State private var path: [String] = []
    /// The native screen under a pushed page, kept while the page no longer shows it.
    @State private var root: SemanticNode?
    /// The native composer's height: the list ends above it.
    @State private var isKeyboardUp = false
    @State private var composerHeight: CGFloat = 80

    private static let brand = Color(red: 0x69 / 255, green: 0x38 / 255, blue: 0xEF / 255)

    var body: some View {
        NavigationStack(path: $path) {
            rootContent
                .navigationDestination(for: String.self) { _ in
                    // The page's own header (title, back chevron) is the bar: one header, the web's.
                    // The system's swipe still pops it.
                    ZStack(alignment: .topLeading) {
                        WebSlot(bridge: bridge, isActive: true)
                            .ignoresSafeArea()
                        if let frame = bridge.listFrame, let composer = bridge.composer {
                            // The message list and the composer, natively: from under the page's
                            // header to the composer, which rides the keyboard (the page never
                            // resizes for it).
                            ZStack(alignment: .bottom) {
                                // The list runs to the screen's bottom edge, under the composer's
                                // glass, and keeps its frame when the keyboard comes (it insets its
                                // rows on the keyboard's curve); the composer rides the keyboard.
                                VStack(spacing: 0) {
                                    Color.clear.frame(height: frame.minY).allowsHitTesting(false)
                                    NativeListHost(bridge: bridge, composerHeight: composerHeight)
                                }
                                .ignoresSafeArea(.keyboard)
                                .ignoresSafeArea(.container, edges: .bottom)
                                NativeComposer(look: composer, bridge: bridge)
                                    .onGeometryChange(for: CGFloat.self) { $0.size.height } action: { composerHeight = $0 }
                                    // Nearly edge to edge, as the system's own floating inputs.
                                    .padding(.horizontal, 8)
                                    // Low, where a thumb reaches: into the home indicator's room
                                    // when the keyboard is down, just above the keyboard when up.
                                    .padding(
                                        .bottom,
                                        isKeyboardUp ? NativeListView.composerKeyboardGap : -NativeListView.composerHomeDip
                                    )
                            }
                            .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillShowNotification)) { _ in
                                isKeyboardUp = true
                            }
                            .onReceive(NotificationCenter.default.publisher(for: UIResponder.keyboardWillHideNotification)) { _ in
                                isKeyboardUp = false
                            }
                            .ignoresSafeArea(.container, edges: .top)
                            // A web overlay (a picker, a render's full screen) draws in the page:
                            // the page shows, its own list and composer with it (`web/bridge.ts`).
                            .opacity(bridge.isOverlayOpen ? 0 : 1)
                            .allowsHitTesting(!bridge.isOverlayOpen)
                        } else if let frame = bridge.listFrame {
                            NativeListHost(bridge: bridge)
                                .frame(width: frame.width, height: frame.height)
                                .offset(x: frame.minX, y: frame.minY)
                                .ignoresSafeArea()
                        }
                    }
                    .toolbar(.hidden, for: .navigationBar)
                }
        }
        .tint(Self.brand)
        .onChange(of: bridge.screen) { _, screen in follow(screen: screen, tabs: bridge.tabs) }
        .onChange(of: bridge.tabs) { _, tabs in follow(screen: bridge.screen, tabs: tabs) }
        .onChange(of: path) { old, new in
            // The user popped the page (the back button or the swipe): the page goes back too.
            if new.isEmpty, !old.isEmpty, bridge.screen == nil { bridge.swipeBack() }
        }
    }

    @ViewBuilder
    private var rootContent: some View {
        ZStack {
            // Always in the window (`WebSlot`); a native screen covers it.
            WebSlot(bridge: bridge, isActive: path.isEmpty)
                .ignoresSafeArea()
            if let screen = bridge.screen ?? (path.isEmpty ? nil : root) {
                // Under a web overlay (the palette, a dialog) the page shows: the overlay is in it.
                NativeScreen(screen: screen, bridge: bridge)
                    .opacity(bridge.isOverlayOpen ? 0 : 1)
                    .allowsHitTesting(!bridge.isOverlayOpen)
            } else if !bridge.hasSettled {
                // As the launch screen: until the page has settled.
                Color(uiColor: .systemBackground).ignoresSafeArea()
            }
        }
        .toolbar(bridge.screen == nil && path.isEmpty ? .hidden : .automatic, for: .navigationBar)
        .safeAreaInset(edge: .bottom) {
            if bridge.hasSettled && !bridge.tabs.isEmpty && path.isEmpty && !bridge.isOverlayOpen {
                GlassTabBar(tabs: bridge.tabs, icons: bridge.icons, onSelect: bridge.selectTab)
                    .padding(.horizontal, 20)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
    }

    private func follow(screen: SemanticNode?, tabs: [WebTab]) {
        if let screen {
            root = screen
            if !path.isEmpty { path = [] }
        } else if tabs.isEmpty, root != nil, path.isEmpty {
            path = ["page"]
        }
    }
}

/// The page's tab bar island drawn as a floating Liquid Glass bar, with the page's own icons.
struct GlassTabBar: View {
    let tabs: [WebTab]
    let icons: [String: UIImage]
    let onSelect: (String) -> Void
    @Namespace private var glass

    var body: some View {
        GlassEffectContainer(spacing: 0) {
            HStack(spacing: 0) {
                ForEach(tabs) { tab in
                    Button { onSelect(tab.id) } label: { label(tab) }
                        .buttonStyle(.plain)
                }
            }
            .padding(4)
            .glassEffect(.regular.interactive(), in: .capsule)
        }
        .animation(.smooth(duration: 0.3), value: tabs.first(where: \.selected)?.id)
    }

    private func label(_ tab: WebTab) -> some View {
        VStack(spacing: 2) {
            Group {
                if let key = tab.image, let image = icons[key] {
                    Image(uiImage: image).resizable().scaledToFit().frame(width: 24, height: 24)
                } else {
                    Image(systemName: tab.symbol ?? "circle")
                        .font(.system(size: 19, weight: .medium))
                        .symbolVariant(tab.selected ? .fill : .none)
                }
            }
            .frame(height: 24)
                .overlay(alignment: .topTrailing) {
                    if let badge = tab.badge, badge > 0 {
                        Text(badge > 99 ? "99+" : "\(badge)")
                            .font(.system(size: 11, weight: .semibold))
                            .monospacedDigit()
                            .foregroundStyle(.white)
                            .padding(.horizontal, 5)
                            .frame(minWidth: 17, minHeight: 17)
                            .background(.red, in: .capsule)
                            .offset(x: 10, y: -5)
                    }
                }
            Text(tab.title)
                .font(WebFont.font(size: 10, weight: 600))
        }
        .foregroundStyle(tab.color.map { AnyShapeStyle(Color(css: $0)) } ?? (tab.selected ? AnyShapeStyle(.tint) : AnyShapeStyle(.primary)))
        .frame(maxWidth: .infinity, minHeight: 50)
        .contentShape(.capsule)
        .background {
            if tab.selected {
                Capsule()
                    .fill(Color.primary.opacity(0.08))
                    .matchedGeometryEffect(id: "selection", in: glass)
            }
        }
    }
}
