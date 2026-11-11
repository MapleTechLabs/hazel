//! Sign-in on iOS: the system's web authentication sheet shows the hosted sign-in page and hands
//! back its callback link, which goes to the runtime as a link the system opened the app with
//! (`openUrl`), as the macOS app's browser hands it the callback.
use std::cell::{Cell, RefCell};

use hazel_native::outbox::write_line;
use hazel_native::sign_in::open_url_message;
use objc2::rc::Retained;
use objc2::runtime::{NSObject, ProtocolObject};
use objc2::{AllocAnyThread, MainThreadMarker, MainThreadOnly, define_class, msg_send};
use objc2_authentication_services::{
    ASPresentationAnchor, ASWebAuthenticationPresentationContextProviding,
    ASWebAuthenticationSession,
};
use objc2_foundation::{NSError, NSObjectProtocol, NSString, NSURL};
use objc2_ui_kit::UIWindow;

use crate::bridge::log;

/// The sheet showing: its id, the session, and what it presents from (held weakly by the session).
type Showing = (u64, Retained<ASWebAuthenticationSession>, Retained<Anchor>);

thread_local! {
    static SHOWING: RefCell<Option<Showing>> = const { RefCell::new(None) };
    static NEXT_ID: Cell<u64> = const { Cell::new(0) };
}

/// Forgets the sheet `id` once it has ended, unless another has replaced it since.
fn ended(id: u64) {
    SHOWING.with_borrow_mut(|showing| {
        if showing.as_ref().is_some_and(|(current, ..)| *current == id) {
            *showing = None;
        }
    });
}

define_class!(
    // SAFETY: NSObject has no subclassing requirements; the class does not implement `Drop`.
    #[unsafe(super(NSObject))]
    #[thread_kind = MainThreadOnly]
    #[name = "HazelSignInAnchor"]
    /// Presents the sheet over the app's window.
    struct Anchor;

    unsafe impl NSObjectProtocol for Anchor {}

    unsafe impl ASWebAuthenticationPresentationContextProviding for Anchor {
        #[unsafe(method_id(presentationAnchorForWebAuthenticationSession:))]
        fn anchor(&self, _session: &ASWebAuthenticationSession) -> Retained<ASPresentationAnchor> {
            // The app's window; a fresh one if the scene has none (a panic here would unwind
            // through UIKit).
            let mtm = self.mtm();
            let window = crate::bridge::window(mtm).unwrap_or_else(|| UIWindow::new(mtm));
            // UIWindow → UIView → UIResponder → NSObject.
            Retained::into_super(Retained::into_super(Retained::into_super(window)))
        }
    }
);

/// Shows the sign-in page at `url` in the system's sheet; the link it ends on (whose scheme is
/// `callback_scheme`) goes to the runtime. A second request while one shows replaces it.
pub fn start(mtm: MainThreadMarker, url: &str, callback_scheme: &str) {
    let Some(target) = NSURL::URLWithString(&NSString::from_str(url)) else {
        return log(&format!("[host] sign-in: not a URL: {url}"));
    };
    let id = NEXT_ID.get() + 1;
    NEXT_ID.set(id);
    let done = block2::RcBlock::new(move |callback: *mut NSURL, error: *mut NSError| {
        // SAFETY: the session passes a valid URL or error, or null, alive for the call.
        let (callback, error) = unsafe { (callback.as_ref(), error.as_ref()) };
        match (callback.and_then(|url| url.absoluteString()), error) {
            (Some(link), _) => write_line(open_url_message(&link.to_string())),
            // Cancelled or failed: sign-in can start again from the page.
            (None, error) => log(&format!(
                "[host] sign-in ended without a callback: {}",
                error.map_or_else(String::new, |e| e.localizedDescription().to_string())
            )),
        }
        ended(id);
    });
    let anchor: Retained<Anchor> = {
        let this = Anchor::alloc(mtm).set_ivars(());
        unsafe { msg_send![super(this), init] }
    };
    // SAFETY: the completion block lives as long as the session, which copies it. The callback
    // variant (`initWithURL:callback:`) needs iOS 17.4; the app runs on 17.0.
    #[allow(deprecated)]
    let session = unsafe {
        ASWebAuthenticationSession::initWithURL_callbackURLScheme_completionHandler(
            ASWebAuthenticationSession::alloc(),
            &target,
            Some(&NSString::from_str(callback_scheme)),
            &*done as *const _ as *mut _,
        )
    };
    // SAFETY: the anchor outlives the session's use of it (`SHOWING` holds both); cancelling a
    // replaced sheet and starting this one happen on the main thread, as UIKit requires.
    unsafe { session.setPresentationContextProvider(Some(ProtocolObject::from_ref(&*anchor))) };
    if let Some((_, previous, _)) = SHOWING.replace(Some((id, session.clone(), anchor))) {
        unsafe { previous.cancel() };
    }
    if !unsafe { session.start() } {
        log("[host] sign-in: the sheet could not start");
        ended(id);
    }
}
