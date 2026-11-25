import UIKit
import UserNotifications

/// Push notifications, as in Discord:
///
/// - **Registration**: the page asks for it once the user is signed in (`push_register`,
///   `web/push.ts`): the system asks for permission, APNs hands this device's token, and the page
///   registers it with the API (`pushDevice.register`). The page also hands over the API's address
///   and the user's id, kept for the actions below (`PushAccount`).
/// - **A tap** opens the message's channel (`hazel.path`) in the page.
/// - **A message's actions** (the `MESSAGE` category the API sends, `apps/backend/src/worker/objects/user/push.ts`):
///   Reply posts the typed text in the channel (a thread's push is the thread's own channel, so the
///   reply lands in the thread), and Mark as read reads the channel. Both run in the background,
///   without opening the app: the shell calls the API's `/rpc` itself, as the signed-in user (the
///   session in the keychain vault, as a bearer), then clears the channel's notifications here and
///   brings the badge down.
@MainActor
final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        // Before launch ends: a tap or an action that launched the app is handed to the delegate.
        PushCenter.shared.start()
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        PushCenter.shared.registered(deviceToken.map { String(format: "%02x", $0) }.joined())
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: any Error) {
        PushCenter.shared.registrationFailed(error)
    }
}

enum PushError: LocalizedError {
    case denied
    case timedOut
    case signedOut
    case refused(String)

    var errorDescription: String? {
        switch self {
        case .denied: "notifications are not allowed"
        case .timedOut: "APNs gave no token"
        case .signedOut: "signed out"
        case let .refused(reason): reason
        }
    }
}

@MainActor
final class PushCenter: NSObject {
    static let shared = PushCenter()

    static let messageCategory = "MESSAGE"
    static let replyAction = "REPLY"
    static let markReadAction = "MARK_READ"

    /// The APNs host this build's token belongs to (`pushDevice.register`'s `environment`).
    #if DEBUG
    static let environment = "development"
    #else
    static let environment = "production"
    #endif

    /// The page, for a tap's path.
    weak var bridge: WebBridge?
    private var token: String?
    private var waiting: [CheckedContinuation<String, any Error>] = []

    func start() {
        let center = UNUserNotificationCenter.current()
        center.delegate = self
        let reply = UNTextInputNotificationAction(
            identifier: Self.replyAction,
            title: "Reply",
            options: [.authenticationRequired],
            textInputButtonTitle: "Send",
            textInputPlaceholder: "Message"
        )
        let read = UNNotificationAction(identifier: Self.markReadAction, title: "Mark as read", options: [])
        center.setNotificationCategories([
            UNNotificationCategory(identifier: Self.messageCategory, actions: [reply, read], intentIdentifiers: []),
        ])
    }

    /// `push_register`: permission, then this device's token, for the page to register.
    func register(api: String, userId: String) async throws -> [String: Any] {
        guard PushAccount.save(api: api, userId: userId) else { throw PushError.refused("bad api") }
        let granted = try await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound])
        guard granted else { throw PushError.denied }
        let token = try await deviceToken()
        return ["token": token, "bundleId": Bundle.main.bundleIdentifier ?? "", "environment": Self.environment]
    }

    /// The page signed out: the actions have no one to act as.
    func forget() {
        PushAccount.forget()
    }

    private func deviceToken() async throws -> String {
        if let token { return token }
        UIApplication.shared.registerForRemoteNotifications()
        let timeout = Task { [weak self] in
            try await Task.sleep(for: .seconds(20))
            self?.finish(.failure(PushError.timedOut))
        }
        defer { timeout.cancel() }
        return try await withCheckedThrowingContinuation { waiting.append($0) }
    }

    func registered(_ token: String) {
        self.token = token
        finish(.success(token))
    }

    func registrationFailed(_ error: any Error) {
        WebBridge.log.error("[push] no APNs token: \(error.localizedDescription, privacy: .public)")
        finish(.failure(error))
    }

    private func finish(_ result: Result<String, any Error>) {
        let resumed = waiting
        waiting = []
        for continuation in resumed { continuation.resume(with: result) }
    }

    fileprivate func open(_ push: PushRef) {
        guard let path = push.path else { return }
        bridge?.openPath(path)
    }

    fileprivate func perform(_ action: String, on push: PushRef, text: String?) async {
        switch action {
        case Self.replyAction:
            guard let text = text?.trimmingCharacters(in: .whitespacesAndNewlines), !text.isEmpty else { return }
            do {
                try await PushActions.reply(text, to: push)
            } catch {
                WebBridge.log.error("[push] reply failed: \(error.localizedDescription, privacy: .public)")
                await Self.tellReplyFailed(push)
                return
            }
            // Replying reads the channel, as sending from it does. The reply is out either way, so
            // a failure here is only logged: reporting it as unsent would have it sent twice.
            await markRead(push)
        case Self.markReadAction:
            await markRead(push)
        default:
            return
        }
    }

    private func markRead(_ push: PushRef) async {
        do {
            try await PushActions.markRead(push)
            await Self.clearDelivered(push)
        } catch {
            WebBridge.log.error("[push] markRead failed: \(error.localizedDescription, privacy: .public)")
        }
    }

    /// Takes the channel's notifications off the screen and the badge down by as many, from the badge
    /// shown now: each push set it, and so did the app and any earlier action here, so a 0 stays 0.
    private static func clearDelivered(_ push: PushRef) async {
        let center = UNUserNotificationCenter.current()
        let delivered = await center.deliveredNotifications()
            .filter { $0.request.content.threadIdentifier == push.channelId }
            .map(\.request.identifier)
        let read = Set(delivered + [push.requestId])
        center.removeDeliveredNotifications(withIdentifiers: Array(read))
        // Deprecated, but iOS has no other way to read the badge shown (only to set it).
        let shown = UIApplication.shared.applicationIconBadgeNumber
        guard shown > 0 else { return }
        try? await center.setBadgeCount(max(0, shown - read.count))
    }

    /// A reply that did not go out says so, so the text is not silently lost.
    private static func tellReplyFailed(_ push: PushRef) async {
        let content = UNMutableNotificationContent()
        content.title = "Your reply wasn't sent"
        content.body = "Open Hazel to try again."
        content.threadIdentifier = push.channelId
        if let path = push.path { content.userInfo = ["hazel": ["path": path, "channelId": push.channelId]] }
        try? await UNUserNotificationCenter.current().add(
            UNNotificationRequest(identifier: "reply-failed-\(push.requestId)", content: content, trigger: nil)
        )
    }
}

extension PushCenter: UNUserNotificationCenterDelegate {
    /// In the app: shown as on the lock screen (the API holds a push back while a client is in use).
    nonisolated func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification
    ) async -> UNNotificationPresentationOptions {
        [.banner, .list, .sound]
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        guard let push = PushRef(response.notification) else { return }
        let action = response.actionIdentifier
        let text = (response as? UNTextInputNotificationResponse)?.userText
        if action == UNNotificationDefaultActionIdentifier {
            await MainActor.run { PushCenter.shared.open(push) }
            return
        }
        await PushCenter.shared.perform(action, on: push, text: text)
    }
}

/// What a push names (`ApnsPayload.hazel`, `apps/backend/src/services/apns.ts`).
struct PushRef: Sendable {
    let requestId: String
    let channelId: String
    let path: String?
    let messageId: String?
    let organizationId: String?

    nonisolated init?(_ notification: UNNotification) {
        let content = notification.request.content
        guard let hazel = content.userInfo["hazel"] as? [String: Any], let channelId = hazel["channelId"] as? String else {
            return nil
        }
        requestId = notification.request.identifier
        self.channelId = channelId
        path = hazel["path"] as? String
        messageId = hazel["messageId"] as? String
        organizationId = hazel["organizationId"] as? String
    }
}

/// The API and the user the page registered this device for: who the actions act as.
enum PushAccount {
    private static let apiKey = "sh.hazel.push.api"
    private static let userKey = "sh.hazel.push.user"

    struct Account {
        let api: URL
        let userId: String
    }

    nonisolated static var current: Account? {
        guard let api = UserDefaults.standard.string(forKey: apiKey).flatMap(URL.init(string:)),
              let userId = UserDefaults.standard.string(forKey: userKey)
        else { return nil }
        return Account(api: api, userId: userId)
    }

    /// Only an https API (or http on this machine, a local stack).
    static func save(api: String, userId: String) -> Bool {
        guard let url = URL(string: api), let host = url.host,
              url.scheme == "https" || (url.scheme == "http" && ["localhost", "127.0.0.1"].contains(host)),
              !userId.isEmpty
        else { return false }
        UserDefaults.standard.set(api, forKey: apiKey)
        UserDefaults.standard.set(userId, forKey: userKey)
        return true
    }

    static func forget() {
        UserDefaults.standard.removeObject(forKey: apiKey)
        UserDefaults.standard.removeObject(forKey: userKey)
    }
}

/// The API calls the actions make: one RPC each over `POST /rpc` (NDJSON, as the page's own client
/// sends them), with the session as a bearer, so the API authorizes them as any other call.
enum PushActions {
    private static let session: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.httpCookieStorage = nil
        configuration.httpShouldSetCookies = false
        configuration.timeoutIntervalForRequest = 20
        return URLSession(configuration: configuration)
    }()

    /// `channelMember.clearNotifications`: the channel read, its notifications gone.
    nonisolated static func markRead(_ push: PushRef) async throws {
        try await call("channelMember.clearNotifications", ["channelId": push.channelId])
    }

    /// `message.create` in the push's channel, sent once (nothing retries it; a failure tells the user).
    nonisolated static func reply(_ text: String, to push: PushRef) async throws {
        guard let account = PushAccount.current else { throw PushError.signedOut }
        try await call("message.create", [
            "channelId": push.channelId,
            "authorId": account.userId,
            "content": text,
            "embeds": NSNull(),
            "replyToMessageId": NSNull(),
            "threadChannelId": NSNull(),
            "deletedAt": NSNull(),
            "clientNonce": UUID().uuidString.lowercased(),
        ])
    }

    nonisolated private static func call(_ tag: String, _ payload: [String: Any]) async throws {
        guard let account = PushAccount.current, let credential = Vault.sessionCredential() else {
            throw PushError.signedOut
        }
        var request = URLRequest(url: account.api.appendingPathComponent("rpc"))
        request.httpMethod = "POST"
        request.setValue("application/ndjson", forHTTPHeaderField: "Content-Type")
        request.setValue("Bearer \(credential)", forHTTPHeaderField: "Authorization")
        let message: [String: Any] = ["_tag": "Request", "id": "1", "tag": tag, "payload": payload, "headers": []]
        var body = try JSONSerialization.data(withJSONObject: message)
        body.append(0x0A)
        request.httpBody = body
        let (data, response) = try await session.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0
        guard status == 200 else { throw PushError.refused("\(tag): HTTP \(status)") }
        try exitOf(data, tag: tag)
    }

    /// The answer's `Exit` line: a success, or the failure's first error tag.
    nonisolated static func exitOf(_ data: Data, tag: String) throws {
        for line in data.split(separator: 0x0A) {
            guard let object = try? JSONSerialization.jsonObject(with: Data(line)) as? [String: Any],
                  object["_tag"] as? String == "Exit", let exit = object["exit"] as? [String: Any]
            else { continue }
            if exit["_tag"] as? String == "Success" { return }
            let cause = (exit["cause"] as? [[String: Any]])?.first
            let error = (cause?["error"] as? [String: Any])?["_tag"] as? String
            throw PushError.refused("\(tag): \(error ?? "failed")")
        }
        throw PushError.refused("\(tag): no answer")
    }
}

extension Vault {
    /// The session credential in the vault's record (`@yielded/auth`'s `VaultRecord`:
    /// `credentials.session.{credential, expiresAtMillis}`), while it has not expired.
    nonisolated static func sessionCredential() -> String? {
        guard let record = read(),
              let object = try? JSONSerialization.jsonObject(with: Data(record.utf8)) as? [String: Any],
              let session = (object["credentials"] as? [String: Any])?["session"] as? [String: Any],
              let credential = session["credential"] as? String, !credential.isEmpty
        else { return nil }
        if let expires = (session["expiresAtMillis"] as? NSNumber)?.doubleValue,
           expires <= Date().timeIntervalSince1970 * 1000 {
            return nil
        }
        return credential
    }
}
