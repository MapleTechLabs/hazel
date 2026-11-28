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
                // A deep link (`hazelchat:///acme/chat/c1`) opens its page, cold start or not.
                .onOpenURL { url in AppLinks.path(of: url).map(model.openPath) }
        }
    }
}

/// The running script; one per install (`restart`).
@MainActor
@Observable
final class AppModel: PathOpener {
    private(set) var runtime: AppRuntime!

    init() {
        runtime = makeRuntime()
        FallbackPages.register()
        FallbackPages.open = { [weak self] path in self?.openPath(path) }
    }

    private func makeRuntime() -> AppRuntime {
        AppRuntime(shell: ShellCommands(
            setServer: { [weak self] document in
                ChosenServer.set(document)
                self?.restart()
            },
            restart: { [weak self] in self?.restart() }
        ))
    }

    /// An in-app path (a push's, a link's): the shell opens it (`PhoneShell`'s `ShellIntents`).
    func openPath(_ path: String) {
        guard path.hasPrefix("/"), !path.hasPrefix("//") else { return }
        runtime.openPath(path)
    }

    /// Starts over on another install (or Hazel's again): a fresh script, no pages kept.
    func restart() {
        FallbackPages.forget()
        runtime.stop()
        runtime = makeRuntime()
        runtime.start()
    }
}

struct AppRoot: View {
    let model: AppModel

    var body: some View {
        ZStack {
            HazelTheme.Recipes.screen.style(sizeClass: .compact).background?.color.ignoresSafeArea()
            TreeView(tree: model.runtime.tree)
        }
        // A link to one of the app's own pages opens in the app; any other URL with the system.
        .environment(\.openURL, OpenURLAction { url in
            guard let path = AppLinks.path(of: url) else { return .systemAction }
            model.openPath(path)
            return .handled
        })
        .id(ObjectIdentifier(model.runtime))
        .task(id: ObjectIdentifier(model.runtime)) { model.runtime.start() }
    }
}

/// Which URLs are the app's own pages: a bare path (`/acme/chat/c1`), a deep link
/// (`hazelchat:///acme/chat/c1`), or a page of the install's web app, by its path and query.
enum AppLinks {
    static let scheme = "hazelchat"

    static func path(of url: URL) -> String? {
        let isRelative = url.scheme == nil && url.host == nil
        let isDeepLink = url.scheme == scheme
        let isOwn = url.host == HostBridge.appOrigin.host && url.scheme == "https"
        guard isRelative || isDeepLink || isOwn else { return nil }
        guard let components = URLComponents(url: url, resolvingAgainstBaseURL: true) else { return nil }
        let path = components.percentEncodedPath.isEmpty ? "/" : components.percentEncodedPath
        guard path.hasPrefix("/") else { return nil }
        return components.percentEncodedQuery.map { "\(path)?\($0)" } ?? path
    }
}
