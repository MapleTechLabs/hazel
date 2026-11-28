import AuthenticationServices
import CryptoKit
import Foundation
import JavaScriptCore
import UIKit

/// What browser sign-in needs from the host (`packages/client-data/src/platform/jsc/auth.ts`):
/// SHA-256 for its PKCE challenge (JavaScriptCore has no `crypto.subtle`) and the system's sign-in
/// sheet, which hands back the app's callback URL.
final class NativeAuth: @unchecked Sendable {
    private let pump: JSCallbackPump

    init(pump: JSCallbackPump) { self.pump = pump }

    func object(in context: JSContext) -> JSValue {
        let sha256: @convention(block) (JSValue) -> JSValue = { bytes in
            let digest = SHA256.hash(data: JSBytes.data(bytes) ?? Data())
            return JSBytes.uint8Array(Data(digest), in: JSContext.current())
        }
        let openSignIn: @convention(block) (String, String, Bool, JSValue) -> Void = { [pump] url, scheme, ephemeral, done in
            let callback = JSCallback(done, pump: pump)
            guard let target = URL(string: url) else {
                callback.call([NSNull(), "bad url"])
                return
            }
            DispatchQueue.main.async {
                MainActor.assumeIsolated { SignInSheet.shared.open(target, scheme: scheme, ephemeral: ephemeral, callback: callback) }
            }
        }
        let cancelSignIn: @convention(block) () -> Void = {
            DispatchQueue.main.async { MainActor.assumeIsolated { SignInSheet.shared.cancel() } }
        }
        let object = JSValue(newObjectIn: context)!
        object.setObject(sha256, forKeyedSubscript: "sha256" as NSString)
        object.setObject(cancelSignIn, forKeyedSubscript: "cancelSignIn" as NSString)
        object.setObject(openSignIn, forKeyedSubscript: "openSignIn" as NSString)
        return object
    }
}

/// One `ASWebAuthenticationSession` at a time: a new sign-in cancels the one before it, whose
/// caller hears `cancelled`.
@MainActor
final class SignInSheet: NSObject, ASWebAuthenticationPresentationContextProviding {
    static let shared = SignInSheet()
    private var session: ASWebAuthenticationSession?

    /// `ephemeral`: no cookies shared with Safari, so the sheet asks to sign in afresh.
    func open(_ url: URL, scheme: String, ephemeral: Bool, callback: JSCallback) {
        session?.cancel()
        let session = ASWebAuthenticationSession(url: url, callback: .customScheme(scheme)) { returned, error in
            if let returned {
                callback.call([returned.absoluteString, NSNull()])
            } else {
                let cancelled = (error as? ASWebAuthenticationSessionError)?.code == .canceledLogin
                callback.call([NSNull(), cancelled ? "cancelled" : (error?.localizedDescription ?? "unavailable")])
            }
        }
        session.presentationContextProvider = self
        session.prefersEphemeralWebBrowserSession = ephemeral
        self.session = session
        if !session.start() { callback.call([NSNull(), "unavailable"]) }
    }

    /// Dismisses the open sheet (its caller stopped waiting); its callback still answers `cancelled`.
    func cancel() {
        session?.cancel()
        session = nil
    }

    nonisolated func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        MainActor.assumeIsolated {
            UIApplication.shared.connectedScenes
                .compactMap { ($0 as? UIWindowScene)?.keyWindow }
                .first ?? ASPresentationAnchor()
        }
    }
}
