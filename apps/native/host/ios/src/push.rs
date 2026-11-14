//! Push notifications on iOS. APNs hands the app a device token once the user allows
//! notifications (`hazel_native::notify::permission`, the web app's own flow); the runtime
//! registers it with the API (`pushDevice.register`, `src/push.ts`), whose pushes then show while
//! the app is away. A tap on one opens the app at the notification's `hazel.path`.
//!
//! Winit's iOS event loop runs `UIApplicationMain` without an application delegate, so the app
//! sets its own (`HazelAppDelegate`) for the two calls APNs makes, just before it registers.
use std::cell::{Cell, RefCell};
use std::ptr::NonNull;

use block2::{DynBlock, RcBlock};
use dispatch2::DispatchQueue;
use objc2::rc::Retained;
use objc2::runtime::ProtocolObject;
use objc2::{MainThreadMarker, MainThreadOnly, define_class, msg_send};
use objc2_foundation::{
    NSBundle, NSData, NSDictionary, NSError, NSNotification, NSNotificationCenter, NSObject,
    NSObjectProtocol, NSOperationQueue, NSString,
};
use objc2_ui_kit::{
    UIApplication, UIApplicationDelegate, UIApplicationDidBecomeActiveNotification,
};
use objc2_user_notifications::{
    UNNotification, UNNotificationPresentationOptions, UNNotificationResponse,
    UNNotificationSettings, UNPushNotificationTrigger, UNUserNotificationCenter,
    UNUserNotificationCenterDelegate,
};

use crate::bridge::log;

thread_local! {
    static NOTIFICATIONS: RefCell<Option<Retained<Notifications>>> = const { RefCell::new(None) };
    /// The application's delegate (UIKit holds it weakly).
    static APP_DELEGATE: RefCell<Option<Retained<AppDelegate>>> = const { RefCell::new(None) };
    /// The app has been active once: it checked whether it may register for pushes.
    static LAUNCHED: Cell<bool> = const { Cell::new(false) };
}

/// Before the app runs: the notification center's delegate (Apple asks for it before launch
/// ends, so a tap that launched the app is heard), and what the app does each time it becomes
/// active.
pub fn install(mtm: MainThreadMarker) {
    let delegate: Retained<Notifications> = {
        let this = Notifications::alloc(mtm).set_ivars(());
        unsafe { msg_send![super(this), init] }
    };
    UNUserNotificationCenter::currentNotificationCenter()
        .setDelegate(Some(ProtocolObject::from_ref(&*delegate)));
    NOTIFICATIONS.set(Some(delegate));

    let block = RcBlock::new(|_: NonNull<NSNotification>| became_active());
    // SAFETY: UIKit's constant; the center copies the block.
    let token = unsafe {
        NSNotificationCenter::defaultCenter().addObserverForName_object_queue_usingBlock(
            Some(UIApplicationDidBecomeActiveNotification),
            None,
            Some(&NSOperationQueue::mainQueue()),
            &block,
        )
    };
    // The app observes for as long as it runs.
    std::mem::forget(token);
}

/// The app came to the front: what it showed as unread is about to be seen, so the badge goes.
/// The first time (the launch), an app the user allowed already registers again: the token can
/// change, and the API keeps the latest.
fn became_active() {
    UNUserNotificationCenter::currentNotificationCenter()
        .setBadgeCount_withCompletionHandler(0, None);
    if LAUNCHED.replace(true) {
        return;
    }
    let answered = RcBlock::new(|settings: NonNull<UNNotificationSettings>| {
        // SAFETY: the framework passes valid settings.
        if hazel_native::notify::allowed(unsafe { settings.as_ref() }) {
            after_permission(true);
        }
    });
    UNUserNotificationCenter::currentNotificationCenter()
        .getNotificationSettingsWithCompletionHandler(&answered);
}

/// The user's answer to the notification permission (or the settings it was read from): once
/// allowed, the app registers for pushes, on the main thread as UIKit asks.
pub fn after_permission(granted: bool) {
    DispatchQueue::main().exec_async(move || {
        log(&format!(
            "[push] notification permission: {}",
            if granted { "granted" } else { "not granted" }
        ));
        if !granted {
            return;
        }
        let Some(mtm) = MainThreadMarker::new() else {
            return;
        };
        let app = UIApplication::sharedApplication(mtm);
        APP_DELEGATE.with_borrow_mut(|held| {
            if held.is_none() {
                let delegate: Retained<AppDelegate> = {
                    let this = AppDelegate::alloc(mtm).set_ivars(());
                    unsafe { msg_send![super(this), init] }
                };
                // SAFETY: the delegate lives as long as the app (`APP_DELEGATE`).
                unsafe { app.setDelegate(Some(ProtocolObject::from_ref(&*delegate))) };
                *held = Some(delegate);
            }
        });
        app.registerForRemoteNotifications();
    });
}

/// A device token as APNs's provider API takes it: lowercase hex.
fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

/// The path a notification opens the app at: its `hazel.path`, an app path.
fn path_of(user_info: &NSDictionary) -> Option<String> {
    let hazel = user_info.objectForKey(&**NSString::from_str("hazel"))?;
    let hazel = hazel.downcast::<NSDictionary>().ok()?;
    let path = hazel.objectForKey(&**NSString::from_str("path"))?;
    let path = path.downcast::<NSString>().ok()?.to_string();
    path.starts_with('/').then_some(path)
}

define_class!(
    // SAFETY: NSObject has no subclassing requirements; the class does not implement `Drop`.
    #[unsafe(super(NSObject))]
    #[thread_kind = MainThreadOnly]
    #[name = "HazelAppDelegate"]
    /// Hears APNs's answer to the app's registration.
    struct AppDelegate;

    unsafe impl NSObjectProtocol for AppDelegate {}

    unsafe impl UIApplicationDelegate for AppDelegate {
        #[unsafe(method(application:didRegisterForRemoteNotificationsWithDeviceToken:))]
        fn registered(&self, _app: &UIApplication, token: &NSData) {
            let token = hex(&token.to_vec());
            let bundle_id = NSBundle::mainBundle()
                .bundleIdentifier()
                .map(|id| id.to_string())
                .unwrap_or_default();
            log(&format!(
                "[push] device token {}… for {bundle_id}",
                &token[..token.len().min(8)]
            ));
            crate::bridge::set_push_token(serde_json::json!({
                "pushToken": token,
                "bundleId": bundle_id,
            }));
        }

        #[unsafe(method(application:didFailToRegisterForRemoteNotificationsWithError:))]
        fn failed(&self, _app: &UIApplication, error: &NSError) {
            log(&format!(
                "[push] could not register for pushes: {} ({} {})",
                error.localizedDescription(),
                error.domain(),
                error.code()
            ));
        }
    }
);

define_class!(
    // SAFETY: NSObject has no subclassing requirements; the class does not implement `Drop`.
    #[unsafe(super(NSObject))]
    #[thread_kind = MainThreadOnly]
    #[name = "HazelNotifications"]
    /// The notification center's delegate: what shows while the app is in front, and taps.
    struct Notifications;

    unsafe impl NSObjectProtocol for Notifications {}

    unsafe impl UNUserNotificationCenterDelegate for Notifications {
        /// A push while the app is in front shows nothing: the app shows its own in-app
        /// notification. The web app's own (Settings' test notification) still shows.
        #[unsafe(method(userNotificationCenter:willPresentNotification:withCompletionHandler:))]
        fn will_present(
            &self,
            _center: &UNUserNotificationCenter,
            notification: &UNNotification,
            completion: &DynBlock<dyn Fn(UNNotificationPresentationOptions)>,
        ) {
            let pushed = notification.request().trigger().is_some_and(|trigger| {
                trigger
                    .downcast_ref::<UNPushNotificationTrigger>()
                    .is_some()
            });
            if pushed {
                log("[push] a push arrived while the app is in front: not shown");
            }
            completion.call((if pushed {
                UNNotificationPresentationOptions::empty()
            } else {
                UNNotificationPresentationOptions::Banner
                    | UNNotificationPresentationOptions::List
                    | UNNotificationPresentationOptions::Sound
            },));
        }

        /// A tap on a notification: the app opens at its path, once the runtime can take it.
        #[unsafe(method(userNotificationCenter:didReceiveNotificationResponse:withCompletionHandler:))]
        fn did_receive(
            &self,
            _center: &UNUserNotificationCenter,
            response: &UNNotificationResponse,
            completion: &DynBlock<dyn Fn()>,
        ) {
            let user_info = response.notification().request().content().userInfo();
            match path_of(&user_info) {
                Some(path) => {
                    log(&format!("[push] opened from a notification: {path}"));
                    crate::bridge::open_path(path);
                }
                None => log("[push] opened from a notification without a path"),
            }
            completion.call(());
        }
    }
);
