//! The on-screen keyboard: how far it covers the window's bottom edge. The page keeps its content
//! above it (`State::set_keyboard`), as a browser shrinks its viewport for the keyboard.
use std::ptr::NonNull;

use hazel_native::State;
use objc2::MainThreadMarker;
use objc2_core_foundation::CGRect;
use objc2_foundation::{NSNotification, NSNotificationCenter, NSOperationQueue, NSValue};
use objc2_ui_kit::{
    NSValueUIGeometryExtensions, UICoordinateSpace, UIKeyboardFrameEndUserInfoKey,
    UIKeyboardWillChangeFrameNotification, UIWindow,
};
use rune::AppHandle;

/// From now on, each change of the keyboard's frame (shown, hidden, resized) reaches the page.
pub fn observe(mtm: MainThreadMarker, handle: AppHandle<State>) {
    // The main queue runs the block on the main thread, where `mtm` holds.
    let block = block2::RcBlock::new(move |notification: NonNull<NSNotification>| {
        // SAFETY: the center passes the notification it posts, alive for the call.
        let notification = unsafe { notification.as_ref() };
        let overlap = crate::bridge::window(mtm)
            .zip(final_frame(notification))
            .map_or(0.0, |(window, frame)| covered(&window, frame));
        handle.update_if(move |s: &mut State, _| s.set_keyboard(overlap));
    });
    let center = NSNotificationCenter::defaultCenter();
    // SAFETY: the name is UIKit's constant; the center copies the block.
    let token = unsafe {
        center.addObserverForName_object_queue_usingBlock(
            Some(UIKeyboardWillChangeFrameNotification),
            None,
            Some(&NSOperationQueue::mainQueue()),
            &block,
        )
    };
    // The app observes for as long as it runs.
    std::mem::forget(token);
}

/// The keyboard's frame once it has moved, in screen coordinates.
fn final_frame(notification: &NSNotification) -> Option<CGRect> {
    // SAFETY: UIKit's constant key; its value is the frame as an `NSValue` of a `CGRect`.
    let key = unsafe { UIKeyboardFrameEndUserInfoKey };
    let value = notification.userInfo()?.objectForKey(key)?;
    Some(unsafe { value.downcast::<NSValue>().ok()?.CGRectValue() })
}

/// How many points of `window`'s bottom edge a keyboard at `frame` covers. A keyboard that does
/// not reach that edge (floating or undocked on iPad, or below a window that ends higher up)
/// covers none of it.
fn covered(window: &UIWindow, frame: CGRect) -> f32 {
    let screen = window.screen().coordinateSpace();
    let frame = window.convertRect_fromCoordinateSpace(frame, &screen);
    let bounds = window.bounds();
    let bottom = bounds.origin.y + bounds.size.height;
    let reaches_bottom =
        frame.size.height > 0.0 && frame.origin.y + frame.size.height >= bottom - 1.0;
    if !reaches_bottom || frame.origin.y >= bottom {
        return 0.0;
    }
    (bottom - frame.origin.y.max(bounds.origin.y)) as f32
}
