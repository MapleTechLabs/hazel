import Foundation
import JavaScriptCore
import os
import QuartzCore
import UIKit
import HazelUI

/// The app's script (`script/entry.ts`) in a bare JavaScriptCore context on its own thread
/// (`JSEngine`): the shared screens commit `hz:*` trees that HazelUI's `TreeHost` applies on the main
/// actor. One runtime per install: changing the install starts a new one (`AppModel.restart`).
@MainActor
final class AppRuntime {
    nonisolated static let log = Logger(subsystem: "sh.hazel.app", category: "runtime")

    let engine = JSEngine()
    let host: TreeHost
    var tree: Tree { host.tree }
    private var started = false
    /// The platform the JS thread installed, for `stop`.
    private let installed = InstalledPlatform()

    init(shell: ShellCommands) {
        host = TreeHost(engine: engine)
        let engine = self.engine
        let server = AppServer.current
        let installed = self.installed
        hooks.append { context in
            installed.platform = NativePlatform.install(
                in: context,
                config: NativePlatformConfig(apiUrl: server.api, standInToken: AppServer.standInToken),
                perform: { block in engine.perform("platform") { _ in block() } }
            )
            let native = context.objectForKeyedSubscript("__native")
            native?.setObject(shell.object(in: context, server: server), forKeyedSubscript: "shell" as NSString)
        }
    }

    private var hooks: [@Sendable (JSContext) -> Void] = []

    /// Ends this runtime: its sockets and requests stop and its JS thread ends (a sign-out, another
    /// install). The tree it drew is dropped with it.
    func stop() {
        let installed = self.installed
        engine.perform("stop") { engine in
            installed.platform?.shutdown()
            installed.platform = nil
            engine.stop()
        }
    }

    /// Paths that arrived before the script ran (a cold start's deep link or push).
    private var pendingPaths: [String] = []

    /// Hands an in-app path to the script (`__hazel.openPath`, `script/entry.ts`).
    func openPath(_ path: String) {
        guard started else { return pendingPaths.append(path) }
        engine.perform("openPath") { engine in _ = engine.call("openPath", with: [path]) }
    }

    func start() {
        guard !started else { return }
        started = true
        guard let url = Bundle.main.url(forResource: "hazel", withExtension: "js", subdirectory: "script"),
              let script = try? String(contentsOf: url, encoding: .utf8)
        else {
            Self.log.error("[app] hazel.js missing from the bundle")
            return
        }
        let hooks = self.hooks
        let paths = pendingPaths
        pendingPaths = []
        engine.perform("mount") { engine in
            let began = CACurrentMediaTime()
            engine.boot(ready: hooks)
            engine.evaluate(script, url: url)
            for path in paths { _ = engine.call("openPath", with: [path]) }
            Self.log.log("[app] script eval \(String(format: "%.1f", (CACurrentMediaTime() - began) * 1000), privacy: .public)ms")
        }
    }
}

/// Written once on the JS thread (the install hook), then read there by `stop`.
private final class InstalledPlatform: @unchecked Sendable {
    var platform: NativePlatform?
}

/// The install the app talks to: the one chosen on the sign-in screen (`ChosenServer`), else the
/// build's. A debug run points elsewhere (the offline fixture, `scripts/fixture-backend.ts`) with
/// launch arguments `-HazelApiUrl <url> -HazelToken fixture`, or `HAZEL_API_URL` / `HAZEL_TOKEN`.
struct AppServer: Sendable {
    let app: String
    let api: String
    let cdn: String?
    let isDefault: Bool

    static var current: AppServer {
        let info = Bundle.main.object(forInfoDictionaryKey: "HazelApiUrl") as? String
        return AppServer(
            app: debug("HazelAppUrl", "HAZEL_APP_URL") ?? HostBridge.appOrigin.absoluteString.trimmingSuffix("/"),
            api: debug("HazelApiUrl", "HAZEL_API_URL") ?? ChosenServer.apiURL ?? info.flatMap { $0.isEmpty ? nil : $0 } ?? "https://api.hazel.sh",
            cdn: ChosenServer.cdnURL ?? "https://cdn.hazel.sh",
            isDefault: ChosenServer.document == nil
        )
    }

    /// A debug run against the local fixture signs in as its stand-in user (loopback only, see
    /// `NativePlatformConfig`).
    static var standInToken: String? { debug("HazelToken", "HAZEL_TOKEN") }

    /// A launch argument (`-<key> <value>`, read through UserDefaults) or environment variable.
    private static func debug(_ argument: String, _ variable: String) -> String? {
        UserDefaults.standard.string(forKey: argument) ?? ProcessInfo.processInfo.environment[variable]
    }
}

/// What the script asks of the app (`script/shell.ts`): the install, and a fresh start (after a
/// sign-out).
struct ShellCommands: Sendable {
    let setServer: @MainActor @Sendable (String?) -> Void
    /// A fresh script; a path (a full load's) opens in it once it has started.
    let restart: @MainActor @Sendable (String?) -> Void

    func object(in context: JSContext, server: AppServer) -> JSValue {
        let object = JSValue(newObjectIn: context)!
        let serverObject = JSValue(newObjectIn: context)!
        serverObject.setObject(server.app, forKeyedSubscript: "app" as NSString)
        serverObject.setObject(server.api, forKeyedSubscript: "api" as NSString)
        serverObject.setObject(server.cdn.map { $0 as Any } ?? NSNull(), forKeyedSubscript: "cdn" as NSString)
        serverObject.setObject(server.isDefault, forKeyedSubscript: "isDefault" as NSString)
        object.setObject(serverObject, forKeyedSubscript: "server" as NSString)
        let set: @convention(block) (JSValue) -> Void = { [setServer] document in
            let value = document.isString ? document.toString() : nil
            DispatchQueue.main.async { MainActor.assumeIsolated { setServer(value) } }
        }
        let restart: @convention(block) (JSValue) -> Void = { [restart] path in
            let value = path.isString ? path.toString() : nil
            DispatchQueue.main.async { MainActor.assumeIsolated { restart(value) } }
        }
        // Not the app's own: the system opens it (Safari, another app).
        let openUrl: @convention(block) (String) -> Void = { url in
            guard let target = URL(string: url) else { return }
            DispatchQueue.main.async { MainActor.assumeIsolated { UIApplication.shared.open(target) } }
        }
        object.setObject(set, forKeyedSubscript: "setServer" as NSString)
        object.setObject(openUrl, forKeyedSubscript: "openUrl" as NSString)
        object.setObject(restart, forKeyedSubscript: "restart" as NSString)
        return object
    }
}

extension String {
    func trimmingSuffix(_ suffix: String) -> String { hasSuffix(suffix) ? String(dropLast(suffix.count)) : self }
}
