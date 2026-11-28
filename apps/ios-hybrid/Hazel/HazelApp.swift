import HazelUI
import SwiftUI

/// The native Hazel app (`docs/ios-native.md`): the shared `hazel` screens drawn by HazelUI, the
/// script in JavaScriptCore, a web view only for a route with no native screen yet.
@main
struct HazelApp: App {
    /// Push notifications: the delegate that hears the APNs token, taps and actions.
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @State private var model: AppModel

    init() {
        Inter.register()
        let model = MainActor.assumeIsolated {
            let model = AppModel()
            PushCenter.shared.bridge = model
            return model
        }
        _model = State(initialValue: model)
    }

    var body: some Scene {
        WindowGroup {
            AppRoot(model: model)
        }
    }
}

/// The running script and the fallback pages pushed over its root.
@MainActor
@Observable
final class AppModel: PathOpener {
    private(set) var runtime: AppRuntime!
    var fallbacks: [FallbackPage] = []

    init() { runtime = makeRuntime() }

    private func makeRuntime() -> AppRuntime {
        AppRuntime(shell: ShellCommands(
            openFallback: { [weak self] path in self?.openPath(path) },
            setServer: { [weak self] document in
                ChosenServer.set(document)
                self?.restart()
            },
            restart: { [weak self] in self?.restart() }
        ))
    }

    /// N0: every path opens in the fallback; the native router takes them over in N1.
    func openPath(_ path: String) {
        guard path.hasPrefix("/"), !path.hasPrefix("//") else { return }
        fallbacks.append(FallbackPage(path: path))
    }

    /// Starts over on another install (or Hazel's again): a fresh script, nothing pushed.
    func restart() {
        fallbacks = []
        runtime = makeRuntime()
        runtime.start()
    }
}

struct AppRoot: View {
    @Bindable var model: AppModel

    var body: some View {
        NavigationStack(path: $model.fallbacks) {
            ZStack {
                HazelTheme.Recipes.screen.style(sizeClass: .compact).background?.color.ignoresSafeArea()
                TreeView(tree: model.runtime.tree)
            }
            .navigationDestination(for: FallbackPage.self) { page in
                FallbackView(page: page)
                    .ignoresSafeArea(edges: .bottom)
                    .navigationBarTitleDisplayMode(.inline)
            }
        }
        .id(ObjectIdentifier(model.runtime))
        .task(id: ObjectIdentifier(model.runtime)) { model.runtime.start() }
    }
}
