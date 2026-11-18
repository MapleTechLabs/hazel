//! System notifications through UserNotifications, for the web app's own notification flow
//! (`core/lib/native-notifications.ts`, over `desktop-bridge.ts`'s `notification`), on macOS and
//! iOS. The system only shows them for an app it knows by its bundle identifier, so a macOS host
//! run from source (no bundle) offers none: the runtime then sees no notification API, as a
//! browser without one. On iOS the permission also covers the app's badge, and pushes are the
//! real channel (`host/ios/src/push.rs`). Windows and Linux have none yet (`available` is false).
//!
//! A notification from a person carries their profile picture. A bundle signed with the
//! Communication Notifications entitlement shows it as a message from them: their picture in
//! place of the app's icon, as Messages and Slack do (an `INSendMessageIntent`). Any other bundle
//! attaches the picture, which the system shows beside the text.
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
pub fn show(_notification: Notification) {}

/// A system notification, as the runtime asks for one (`notify`).
#[derive(serde::Deserialize, Clone, Debug, PartialEq)]
pub struct Notification {
    pub title: String,
    pub body: String,
    /// Gathers a channel's notifications together (the channel's id).
    #[serde(default)]
    pub group: Option<String>,
    /// The sender's profile picture: a web URL.
    #[serde(default)]
    pub image: Option<String>,
    /// Who sent the message, when a person did.
    #[serde(default)]
    pub sender: Option<Sender>,
    /// The channel's name, for a message in a channel (not a direct message).
    #[serde(default)]
    pub conversation: Option<String>,
}

/// The person a notification's message is from.
#[derive(serde::Deserialize, Clone, Debug, PartialEq)]
pub struct Sender {
    /// Their user id: the system tells people apart by it.
    pub id: String,
    pub name: String,
}

/// The side of the square picture a notification carries: its thumbnail is small.
const PICTURE_SIDE: u32 = 256;

/// `bytes` (any picture the app's avatars come as, WebP included) as the square PNG a
/// notification attachment takes (the system reads only PNG, JPEG and GIF), cropped to its
/// centre as the app's avatars are; `None` when they are not a picture.
pub fn attachment_png(bytes: &[u8]) -> Option<Vec<u8>> {
    let picture = image::load_from_memory(bytes).ok()?;
    let side = picture.width().min(picture.height());
    if side == 0 {
        return None;
    }
    let square = picture.crop_imm(
        (picture.width() - side) / 2,
        (picture.height() - side) / 2,
        side,
        side,
    );
    let scaled = if side > PICTURE_SIDE {
        square.resize_exact(
            PICTURE_SIDE,
            PICTURE_SIDE,
            image::imageops::FilterType::Triangle,
        )
    } else {
        square
    };
    let mut png = std::io::Cursor::new(Vec::new());
    scaled
        .to_rgba8()
        .write_to(&mut png, image::ImageFormat::Png)
        .ok()?;
    Some(png.into_inner())
}

#[cfg(target_vendor = "apple")]
mod apple {
    use block2::RcBlock;
    use objc2::rc::Retained;
    use objc2::runtime::Bool;
    use objc2::{AnyThread, msg_send};
    use objc2_foundation::{NSArray, NSBundle, NSData, NSError, NSNumber, NSString, NSURL};
    use objc2_intents::{
        INImage, INInteraction, INInteractionDirection, INOutgoingMessageType, INPerson,
        INPersonHandle, INPersonHandleType, INSendMessageIntent, INSpeakableString,
    };
    use objc2_user_notifications::{
        UNAuthorizationOptions, UNAuthorizationStatus, UNMutableNotificationContent,
        UNNotificationAttachment, UNNotificationContent, UNNotificationRequest,
        UNNotificationSettings, UNUserNotificationCenter,
    };

    use super::{Notification, Sender};
    use std::ptr::NonNull;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::time::Duration;

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

    /// How long a notification waits for its picture before it shows without one.
    const PICTURE_TIMEOUT: Duration = Duration::from_secs(4);

    /// The Info.plist key a bundle signed with the Communication Notifications entitlement
    /// carries (`scripts/bundle.ts`, `scripts/ios.ts`): only such a bundle may show a sender as
    /// a person. Without the entitlement the system would refuse, or quietly drop, the sender.
    const COMMUNICATION_KEY: &str = "HazelCommunicationNotifications";

    /// Whether this bundle shows notifications from a sender as messages from a person.
    fn communication() -> bool {
        NSBundle::mainBundle()
            .objectForInfoDictionaryKey(&NSString::from_str(COMMUNICATION_KEY))
            .and_then(|value| value.downcast::<NSNumber>().ok())
            .is_some_and(|value| value.boolValue())
    }

    /// Shows `notification`. Its picture is downloaded first, off this thread; it shows without
    /// one when that fails.
    pub fn show(notification: Notification) {
        if !available() {
            return;
        }
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let n = NEXT.fetch_add(1, Ordering::Relaxed);
        if notification.image.is_none() {
            return deliver(n, &notification, None);
        }
        std::thread::spawn(move || {
            let png = notification.image.as_deref().and_then(picture_png);
            deliver(n, &notification, png.as_deref());
        });
    }

    /// The picture at `url`, as the square PNG the system takes.
    fn picture_png(url: &str) -> Option<Vec<u8>> {
        let bytes = crate::fetch::get(url, PICTURE_TIMEOUT)
            .map_err(|error| eprintln!("[host] notification picture: {error}"))
            .ok()?;
        super::attachment_png(&bytes)
    }

    /// `png` as an attachment, through a file of its own (the system moves the file into its
    /// store when it takes the notification).
    fn attachment(n: u64, png: &[u8]) -> Option<Retained<UNNotificationAttachment>> {
        let path =
            std::env::temp_dir().join(format!("hazel-notification-{}-{n}.png", std::process::id()));
        std::fs::write(&path, png)
            .map_err(|error| eprintln!("[host] notification picture: {error}"))
            .ok()?;
        let file = NSURL::fileURLWithPath(&NSString::from_str(&path.to_string_lossy()));
        // SAFETY: a file URL to a PNG just written, and no options.
        let attachment = unsafe {
            UNNotificationAttachment::attachmentWithIdentifier_URL_options_error(
                &NSString::from_str("picture"),
                &file,
                None,
            )
        };
        attachment
            .map_err(|error| {
                let _ = std::fs::remove_file(&path);
                eprintln!(
                    "[host] notification picture: {}",
                    error.localizedDescription()
                );
            })
            .ok()
    }

    /// A person for an intent: `id` names them to the system, `image` is their picture.
    fn person(id: &str, name: &str, image: Option<&INImage>, me: bool) -> Retained<INPerson> {
        let id = NSString::from_str(id);
        // SAFETY: plain values; Intents copies them.
        unsafe {
            let handle = INPersonHandle::initWithValue_type(
                INPersonHandle::alloc(),
                Some(&id),
                INPersonHandleType::Unknown,
            );
            INPerson::initWithPersonHandle_nameComponents_displayName_image_contactIdentifier_customIdentifier_isMe(
                INPerson::alloc(),
                &handle,
                None,
                Some(&NSString::from_str(name)),
                image,
                None,
                Some(&id),
                me,
            )
        }
    }

    /// `content` as a message from `sender` (the system draws their picture in place of the
    /// app's icon, as Messages and Slack do), or why it is not: the incoming message is donated
    /// to the system, then the content updated from it. A channel's message is a group
    /// conversation, named by `conversation`.
    fn as_message(
        content: &UNMutableNotificationContent,
        notification: &Notification,
        sender: &Sender,
        png: Option<&[u8]>,
    ) -> Result<Retained<UNNotificationContent>, String> {
        let image = png.map(|png| unsafe { INImage::imageWithImageData(&NSData::with_bytes(png)) });
        let from = person(&sender.id, &sender.name, image.as_deref(), false);
        let group_name = notification.conversation.as_deref().map(|name| unsafe {
            INSpeakableString::initWithSpokenPhrase(
                INSpeakableString::alloc(),
                &NSString::from_str(name),
            )
        });
        // A group conversation has more than one recipient: this user and the sender.
        let recipients = group_name
            .as_ref()
            .map(|_| NSArray::from_retained_slice(&[person("me", "Me", None, true), from.clone()]));
        let conversation = notification.group.as_deref().map(NSString::from_str);
        // SAFETY: plain values; Intents copies them.
        let intent = unsafe {
            INSendMessageIntent::initWithRecipients_outgoingMessageType_content_speakableGroupName_conversationIdentifier_serviceName_sender_attachments(
                INSendMessageIntent::alloc(),
                recipients.as_deref(),
                INOutgoingMessageType::OutgoingMessageText,
                Some(&NSString::from_str(&notification.body)),
                group_name.as_deref(),
                conversation.as_deref(),
                None,
                Some(&from),
                None,
            )
        };
        if let (Some(_), Some(image)) = (&group_name, &image) {
            // SAFETY: a parameter the intent has.
            unsafe {
                intent.setImage_forParameterNamed(
                    Some(image),
                    &NSString::from_str("speakableGroupName"),
                )
            };
        }
        // SAFETY: an intent just made; donating is what lets the system show the sender.
        unsafe {
            let interaction =
                INInteraction::initWithIntent_response(INInteraction::alloc(), &intent, None);
            interaction.setDirection(INInteractionDirection::Incoming);
            interaction.donateInteractionWithCompletion(None);
        }
        // `INSendMessageIntent` conforms to `UNNotificationContentProviding` in Objective-C;
        // objc2's bindings do not say so, hence the message sent by hand.
        let updated: Result<Retained<UNNotificationContent>, Retained<NSError>> =
            unsafe { msg_send![content, contentByUpdatingWithProvider: &*intent, error: _] };
        updated.map_err(|error| error.localizedDescription().to_string())
    }

    fn deliver(n: u64, notification: &Notification, png: Option<&[u8]>) {
        let content = UNMutableNotificationContent::new();
        content.setTitle(&NSString::from_str(&notification.title));
        content.setBody(&NSString::from_str(&notification.body));
        if let Some(group) = &notification.group {
            content.setThreadIdentifier(&NSString::from_str(group));
        }
        let message = match &notification.sender {
            Some(sender) if communication() => as_message(&content, notification, sender, png)
                .map_err(|error| eprintln!("[host] notification as a message: {error}"))
                .ok(),
            _ => None,
        };
        let content: Retained<UNNotificationContent> = match message {
            Some(message) => message,
            // Without the sender drawn as the icon, the picture shows beside the text.
            None => {
                if let Some(picture) = png.and_then(|png| attachment(n, png)) {
                    content.setAttachments(&NSArray::from_retained_slice(&[picture]));
                }
                Retained::into_super(content)
            }
        };
        let id = NSString::from_str(&format!("hazel-{n}"));
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

#[cfg(test)]
mod tests {
    use super::{PICTURE_SIDE, attachment_png};

    fn encoded(width: u32, height: u32, format: image::ImageFormat) -> Vec<u8> {
        // RGB: JPEG has no alpha.
        let picture = image::RgbImage::from_pixel(width, height, image::Rgb([105, 56, 239]));
        let mut bytes = std::io::Cursor::new(Vec::new());
        picture.write_to(&mut bytes, format).unwrap();
        bytes.into_inner()
    }

    #[test]
    fn crops_a_wide_picture_to_a_scaled_square_png() {
        let png = attachment_png(&encoded(800, 400, image::ImageFormat::Png)).unwrap();
        let back = image::load_from_memory_with_format(&png, image::ImageFormat::Png).unwrap();
        assert_eq!((back.width(), back.height()), (PICTURE_SIDE, PICTURE_SIDE));
    }

    #[test]
    fn keeps_a_small_picture_at_its_size_and_converts_jpeg() {
        let png = attachment_png(&encoded(48, 64, image::ImageFormat::Jpeg)).unwrap();
        let back = image::load_from_memory_with_format(&png, image::ImageFormat::Png).unwrap();
        assert_eq!((back.width(), back.height()), (48, 48));
    }

    #[test]
    fn reads_the_runtime_notify_message() {
        use crate::notify::{Notification, Sender};
        use crate::wire::RuntimeMsg;
        let full = r#"{"t":"notify","title":"Ada in #general","body":"Hi","group":"c1",
            "image":"https://cdn.example.com/ada.png","sender":{"id":"u1","name":"Ada"},
            "conversation":"general"}"#;
        let Ok(RuntimeMsg::Notify(notification)) = serde_json::from_str(full) else {
            panic!("not a notify message");
        };
        assert_eq!(
            notification,
            Notification {
                title: "Ada in #general".into(),
                body: "Hi".into(),
                group: Some("c1".into()),
                image: Some("https://cdn.example.com/ada.png".into()),
                sender: Some(Sender {
                    id: "u1".into(),
                    name: "Ada".into()
                }),
                conversation: Some("general".into()),
            }
        );
        let bare = r#"{"t":"notify","title":"T","body":"B"}"#;
        let Ok(RuntimeMsg::Notify(notification)) = serde_json::from_str(bare) else {
            panic!("not a notify message");
        };
        assert_eq!((notification.sender, notification.image), (None, None));
    }

    #[test]
    fn refuses_what_is_not_a_picture() {
        assert!(attachment_png(b"<html>not found</html>").is_none());
    }
}
