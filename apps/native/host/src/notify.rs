//! System notifications through UserNotifications, for the web app's own notification flow
//! (`core/lib/native-notifications.ts`, over `desktop-bridge.ts`'s `notification`). macOS only
//! shows them for an app it knows by its bundle identifier, so a host run from source (no bundle)
//! offers none: the runtime then sees no notification API, as a browser without one.
//! Windows and Linux have none yet (`available` is false), so the runtime offers none.
#[cfg(target_os = "macos")]
pub use mac::{available, permission, show};

#[cfg(not(target_os = "macos"))]
pub fn available() -> bool {
    false
}

#[cfg(not(target_os = "macos"))]
pub fn permission(id: u64, _request: bool) {
    hazel_native::outbox::write_line(hazel_native::shell::permission_reply(id, false));
}

#[cfg(not(target_os = "macos"))]
pub fn show(_title: &str, _body: &str, _group: Option<&str>) {}

#[cfg(target_os = "macos")]
mod mac {
    use block2::RcBlock;
    use objc2::runtime::Bool;
    use objc2_foundation::{NSBundle, NSError, NSString};
    use objc2_user_notifications::{
        UNAuthorizationOptions, UNAuthorizationStatus, UNMutableNotificationContent,
        UNNotificationRequest, UNNotificationSettings, UNUserNotificationCenter,
    };
    use std::ptr::NonNull;
    use std::sync::atomic::{AtomicU64, Ordering};

    use hazel_native::outbox::write_line;
    use hazel_native::shell::permission_reply;

    /// Whether this process can show notifications: it runs from a bundle with an identifier.
    /// (Asking for the notification center without one raises an Objective-C exception.)
    pub fn available() -> bool {
        NSBundle::mainBundle().bundleIdentifier().is_some()
    }

    /// Answers permission request `id`: whether notifications are allowed, asking the user first
    /// when `request` is set and they have not decided yet.
    pub fn permission(id: u64, request: bool) {
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
            });
            center.requestAuthorizationWithOptions_completionHandler(
                UNAuthorizationOptions::Alert | UNAuthorizationOptions::Sound,
                &answered,
            );
        } else {
            let answered = RcBlock::new(move |settings: NonNull<UNNotificationSettings>| {
                // SAFETY: the framework passes valid settings.
                let status = unsafe { settings.as_ref() }.authorizationStatus();
                let granted = status == UNAuthorizationStatus::Authorized
                    || status == UNAuthorizationStatus::Provisional;
                write_line(permission_reply(id, granted));
            });
            center.getNotificationSettingsWithCompletionHandler(&answered);
        }
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
