//! System notifications through UserNotifications, for the web app's own notification flow
//! (`core/lib/native-notifications.ts`, over `desktop-bridge.ts`'s `notification`), on macOS and
//! iOS. The system only shows them for an app it knows by its bundle identifier, so a macOS host
//! run from source (no bundle) offers none: the runtime then sees no notification API, as a
//! browser without one. On iOS the permission also covers the app's badge, and pushes are the
//! real channel (`host/ios/src/push.rs`). Windows and Linux have none yet (`available` is false).
#[cfg(target_vendor = "apple")]
pub use apple::{allowed, available, permission, show};

#[cfg(not(target_vendor = "apple"))]
pub fn available() -> bool {
    false
}

#[cfg(not(target_vendor = "apple"))]
pub fn permission(id: u64, _request: bool, _then: fn(bool)) {
    crate::outbox::write_line(crate::shell::permission_reply(id, false));
}

#[cfg(not(target_vendor = "apple"))]
pub fn show(_title: &str, _body: &str, _group: Option<&str>) {}

#[cfg(target_vendor = "apple")]
mod apple {
    use block2::RcBlock;
    use objc2::runtime::Bool;
    use objc2_foundation::{NSBundle, NSError, NSString};
    use objc2_user_notifications::{
        UNAuthorizationOptions, UNAuthorizationStatus, UNMutableNotificationContent,
        UNNotificationRequest, UNNotificationSettings, UNUserNotificationCenter,
    };
    use std::ptr::NonNull;
    use std::sync::atomic::{AtomicU64, Ordering};

    use crate::outbox::write_line;
    use crate::shell::permission_reply;

    /// What the app asks to do: a phone's notifications also set the app's badge.
    fn options() -> UNAuthorizationOptions {
        let options = UNAuthorizationOptions::Alert | UNAuthorizationOptions::Sound;
        if cfg!(target_os = "ios") {
            options | UNAuthorizationOptions::Badge
        } else {
            options
        }
    }

    /// Whether this process can show notifications: it runs from a bundle with an identifier.
    /// (Asking for the notification center without one raises an Objective-C exception.)
    pub fn available() -> bool {
        NSBundle::mainBundle().bundleIdentifier().is_some()
    }

    /// Answers permission request `id`: whether notifications are allowed, asking the user first
    /// when `request` is set and they have not decided yet. `then` hears the answer too, on the
    /// framework's queue (iOS registers for pushes once allowed).
    pub fn permission(id: u64, request: bool, then: fn(bool)) {
        if !available() {
            return write_line(permission_reply(id, false));
        }
        let center = UNUserNotificationCenter::currentNotificationCenter();
        if request {
            let answered = RcBlock::new(move |granted: Bool, error: *mut NSError| {
                // SAFETY: the framework passes a valid error, or null.
                if let Some(error) = unsafe { error.as_ref() } {
                    eprintln!(
                        "[host] notification permission: {}",
                        error.localizedDescription()
                    );
                }
                write_line(permission_reply(id, granted.as_bool()));
                then(granted.as_bool());
            });
            center.requestAuthorizationWithOptions_completionHandler(options(), &answered);
        } else {
            let answered = RcBlock::new(move |settings: NonNull<UNNotificationSettings>| {
                // SAFETY: the framework passes valid settings.
                let granted = allowed(unsafe { settings.as_ref() });
                write_line(permission_reply(id, granted));
                then(granted);
            });
            center.getNotificationSettingsWithCompletionHandler(&answered);
        }
    }

    /// Whether `settings` let the app notify (provisional delivery counts).
    pub fn allowed(settings: &UNNotificationSettings) -> bool {
        let status = settings.authorizationStatus();
        status == UNAuthorizationStatus::Authorized || status == UNAuthorizationStatus::Provisional
    }

    /// Shows a notification now; `group` threads a channel's notifications together.
    pub fn show(title: &str, body: &str, group: Option<&str>) {
        if !available() {
            return;
        }
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let content = UNMutableNotificationContent::new();
        content.setTitle(&NSString::from_str(title));
        content.setBody(&NSString::from_str(body));
        if let Some(group) = group {
            content.setThreadIdentifier(&NSString::from_str(group));
        }
        let id = NSString::from_str(&format!("hazel-{}", NEXT.fetch_add(1, Ordering::Relaxed)));
        let request =
            UNNotificationRequest::requestWithIdentifier_content_trigger(&id, &content, None);
        let done = RcBlock::new(|error: *mut NSError| {
            // SAFETY: the framework passes a valid error, or null.
            if let Some(error) = unsafe { error.as_ref() } {
                eprintln!(
                    "[host] notification not shown: {}",
                    error.localizedDescription()
                );
            }
        });
        UNUserNotificationCenter::currentNotificationCenter()
            .addNotificationRequest_withCompletionHandler(&request, Some(&done));
    }
}
