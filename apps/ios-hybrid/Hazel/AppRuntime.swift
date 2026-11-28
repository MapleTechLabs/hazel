import Foundation
import JavaScriptCore
import os
import QuartzCore
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

    init(shell: ShellCommands) {
        host = TreeHost(engine: engine)
        let engine = self.engine
        let server = AppServer.current
        hooks.append { context in
            _ = NativePlatform.install(
                in: context,
                config: NativePlatformConfig(apiUrl: server.api, standInToken: AppServer.standInToken),
                perform: { block in engine.perform("platform") { _ in block() } }
            )
            let native = context.objectForKeyedSubscript("__native")
            native?.setObject(shell.object(in: context, server: server), forKeyedSubscript: "shell" as NSString)
        }
    }

    private var hooks: [@Sendable (JSContext) -> Void] = []

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
        engine.perform("mount") { engine in
            let began = CACurrentMediaTime()
            engine.boot(ready: hooks)
            engine.evaluate(script, url: url)
            Self.log.log("[app] script eval \(String(format: "%.1f", (CACurrentMediaTime() - began) * 1000), privacy: .public)ms")
        }
    }
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

/// What the script asks of the app (`script/shell.ts`): the web fallback and the install.
struct ShellCommands: Sendable {
    let openFallback: @MainActor @Sendable (String) -> Void
    let setServer: @MainActor @Sendable (String?) -> Void

    func object(in context: JSContext, server: AppServer) -> JSValue {
        let object = JSValue(newObjectIn: context)!
        let serverObject = JSValue(newObjectIn: context)!
        serverObject.setObject(server.app, forKeyedSubscript: "app" as NSString)
        serverObject.setObject(server.api, forKeyedSubscript: "api" as NSString)
        serverObject.setObject(server.cdn.map { $0 as Any } ?? NSNull(), forKeyedSubscript: "cdn" as NSString)
        serverObject.setObject(server.isDefault, forKeyedSubscript: "isDefault" as NSString)
        object.setObject(serverObject, forKeyedSubscript: "server" as NSString)
        let open: @convention(block) (String) -> Void = { [openFallback] path in
            DispatchQueue.main.async { MainActor.assumeIsolated { openFallback(path) } }
        }
        let set: @convention(block) (JSValue) -> Void = { [setServer] document in
            let value = document.isString ? document.toString() : nil
            DispatchQueue.main.async { MainActor.assumeIsolated { setServer(value) } }
        }
        object.setObject(open, forKeyedSubscript: "openFallback" as NSString)
        object.setObject(set, forKeyedSubscript: "setServer" as NSString)
        return object
    }
}

extension String {
    func trimmingSuffix(_ suffix: String) -> String { hasSuffix(suffix) ? String(dropLast(suffix.count)) : self }
}
