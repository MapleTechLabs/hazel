import SwiftUI

@main
struct HazelHybridApp: App {
    init() {
        WebBridge.log.log("[shell] launch")
        WebFont.register()
        MainActor.assumeIsolated { FrameMonitor.shared.start() }
    }

    var body: some Scene {
        WindowGroup {
            ShellView()
        }
    }
}
