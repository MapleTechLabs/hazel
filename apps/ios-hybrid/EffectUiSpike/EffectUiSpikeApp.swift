import HazelUI
import SwiftUI

/// The `hazel` vocabulary on a native host (G1, `docs/hazel-ui.md`): the shared ChannelList runs in
/// JavaScriptCore and HazelUI's `TreeView` draws the `hz:*` tree it commits, with each lane's
/// primitive views. No web view.
@main
struct EffectUiSpikeApp: App {
    @State private var runtime: EffectUiRuntime

    init() {
        Inter.register()
        let runtime = MainActor.assumeIsolated {
            DemoExtensions.register()
            return EffectUiRuntime()
        }
        _runtime = State(initialValue: runtime)
    }

    /// `-HazelScreen gallery`: every conformance case through `TreeView` instead of the script.
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
            HazelTheme.Recipes.screen.style(sizeClass: .compact).background?.color.ignoresSafeArea()
            TreeView(tree: runtime.tree)
        }
        .overlay(alignment: .bottom) {
            VStack(spacing: 4) {
                TreeStats(host: runtime.host)
                G4DebugBar(runtime: runtime)
            }
        }
        .task {
            runtime.start()
            G4Bench.autorun(runtime)
        }
    }
}

/// What the last batch cost, so the numbers are in the screenshot.
struct TreeStats: View {
    let host: TreeHost

    var body: some View {
        Text("wire v\(WIRE_VERSION) · \(host.batches) batches · last \(host.lastOps) ops, \(host.lastBytes) B, \(String(format: "%.2f", host.lastApplyMs)) ms")
            .font(Inter.font(size: 12, weight: 400))
            .foregroundStyle(HazelTheme.Colors.mutedFg.color)
        if let error = host.lastError {
            Text(error).font(Inter.font(size: 12, weight: 400)).foregroundStyle(HazelTheme.Colors.danger.color)
        }
    }
}
