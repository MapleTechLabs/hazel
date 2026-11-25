import SwiftUI
import UIKit

@main
struct HazelHybridApp: App {
    /// Push notifications: the delegate that hears the APNs token, taps and actions.
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    /// Made here, before the window and scene exist: the page starts loading while the system is
    /// still setting them up, a quarter of a second earlier than from the first view.
    @State private var bridge: WebBridge

    init() {
        WebBridge.log.log("[shell] launch")
        WebFont.register()
        let bridge = MainActor.assumeIsolated {
            FrameMonitor.shared.start()
            let bridge = WebBridge()
            _ = bridge.webView
            PushCenter.shared.bridge = bridge
            return bridge
        }
        _bridge = State(initialValue: bridge)
    }

    var body: some Scene {
        WindowGroup {
            ShellView(bridge: bridge)
        }
    }
}

extension UIColor {
    /// The page's own background, light and dark (`--bg`): the launch screen's too (`project.yml`).
    static let pageBackground = UIColor(named: "LaunchBackground") ?? .systemBackground
}
