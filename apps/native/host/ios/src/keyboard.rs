//! The on-screen keyboard: how far it covers the window's bottom edge. The page keeps its content
//! above it (`State::set_keyboard`), as a browser shrinks its viewport for the keyboard.
use std::ptr::NonNull;

use hazel_native::State;
use objc2::MainThreadMarker;
use objc2_foundation::{NSNotification, NSNotificationCenter, NSValue};
use objc2_ui_kit::{
    NSValueUIGeometryExtensions, UIKeyboardFrameEndUserInfoKey,
    UIKeyboardWillChangeFrameNotification, UIScreen,
};
use rune::AppHandle;

/// From now on, each change of the keyboard's frame (shown, hidden, resized) reaches the page.
pub fn observe(mtm: MainThreadMarker, handle: AppHandle<State>) {
    let block = block2::RcBlock::new(move |notification: NonNull<NSNotification>| {
        // SAFETY: UIKit passes the notification it posts, alive for the call.
        let notification = unsafe { notification.as_ref() };
        let overlap = covered(mtm, notification);
        handle.update_if(move |s: &mut State, _| s.set_keyboard(overlap));
    });
    let center = NSNotificationCenter::defaultCenter();
    let token = unsafe {
        center.addObserverForName_object_queue_usingBlock(
            Some(UIKeyboardWillChangeFrameNotification),
            None,
            None,
            &block,
        )
    };
    // The app observes for as long as it runs.
    std::mem::forget(token);
}

/// How many points of the screen's bottom edge the keyboard's final frame covers (0 once hidden).
fn covered(mtm: MainThreadMarker, notification: &NSNotification) -> f32 {
    let Some(frame) = notification
        .userInfo()
        .and_then(|info| info.objectForKey(unsafe { UIKeyboardFrameEndUserInfoKey }))
        .and_then(|value| value.downcast::<NSValue>().ok())
        .map(|value| unsafe { value.CGRectValue() })
    else {
        return 0.0;
    };
    // The window covers the screen, so the keyboard's screen frame is in its coordinates too.
    #[allow(deprecated)]
    let screen = UIScreen::mainScreen(mtm).bounds();
    (screen.size.height - frame.origin.y).clamp(0.0, screen.size.height) as f32
}
