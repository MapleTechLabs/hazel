import SwiftUI

/// The `hazel` vocabulary on a native host (G1, `docs/hazel-ui.md`): the shared ChannelList runs in
/// JavaScriptCore and SwiftUI draws the `hz:*` tree it commits, in Hazel's look (`Theme`). No web view.
@main
struct EffectUiSpikeApp: App {
    @State private var runtime: EffectUiRuntime

    init() {
        Inter.register()
        let runtime = MainActor.assumeIsolated {
            HazelExtensions.registerDemo()
            return EffectUiRuntime()
        }
        _runtime = State(initialValue: runtime)
    }

    var body: some Scene {
        WindowGroup {
            ZStack {
                Theme.screenBg.ignoresSafeArea()
                ForEach(runtime.tree.root) { HzView(node: $0, runtime: runtime) }
            }
            .task { runtime.start() }
        }
    }
}
