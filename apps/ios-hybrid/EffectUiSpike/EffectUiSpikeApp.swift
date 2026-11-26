import HazelUI
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

    /// `-HazelScreen gallery`: every conformance case through HazelUI's `TreeView` instead of the script.
    private let gallery = UserDefaults.standard.string(forKey: "HazelScreen") == "gallery"

    var body: some Scene {
        WindowGroup {
            if gallery, let fixtures = Bundle.main.url(forResource: "fixtures", withExtension: nil) {
                HazelGallery(fixtures: fixtures)
            } else {
                spike
            }
        }
    }

    private var spike: some View {
            ZStack {
                Theme.screenBg.ignoresSafeArea()
                ForEach(runtime.tree.root) { HzView(node: $0, runtime: runtime) }
            }
            .overlay(alignment: .bottom) { G4DebugBar(runtime: runtime) }
            .task {
                runtime.start()
                G4Bench.autorun(runtime)
            }
    }
}
