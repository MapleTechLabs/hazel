//! The phone's own controls the app asks for (`web-foldkit/src/platform/system-ui.ts`): a tap of
//! the finger, and navigation that moves as a navigation stack's does.
//!
//! Rune draws the whole page in one view, so the page left behind is gone once the next is
//! drawn. The runtime says before every in-app navigation where it goes (`navigate`), and the
//! host takes a picture of the page it leaves (`snapshotViewAfterScreenUpdates:`, of what Rune
//! drew last). With that picture:
//! - a page that leads back to the one left (it has a back chevron to it) slides in from the right
//!   over it, the old page drifting left and dimming (a push);
//! - going back slides the page off to the right, over the picture of the page it goes to (a pop);
//! - the swipe from the left edge does the same under the finger, and goes back when let go far
//!   or fast enough;
//! - anything else (a tab) changes at once.
use std::cell::{Cell, RefCell};
use std::time::{Duration, Instant};

use block2::RcBlock;
use dispatch2::{DispatchQueue, DispatchTime};
use objc2::rc::Retained;
use objc2::runtime::{Bool, ProtocolObject};
use objc2::{MainThreadMarker, MainThreadOnly, define_class, msg_send, sel};
use objc2_core_foundation::{CGAffineTransform, CGFloat, CGSize};
use objc2_foundation::{NSObject, NSObjectProtocol};
use objc2_ui_kit::{
    UIBezierPath, UIColor, UIGestureRecognizer, UIGestureRecognizerDelegate,
    UIImpactFeedbackGenerator, UIImpactFeedbackStyle, UIPanGestureRecognizer, UIView,
    UIViewAnimationOptions,
};
use serde_json::Value;

use crate::bridge::{log, reply, window};

/// A tap of the finger, as a long-press's menu gives.
pub fn haptic(mtm: MainThreadMarker) {
    // `feedbackGeneratorWithStyle:forView:` replaces it from iOS 17.5; the app runs on 17.0.
    #[allow(deprecated)]
    let generator = UIImpactFeedbackGenerator::initWithStyle(
        UIImpactFeedbackGenerator::alloc(mtm),
        UIImpactFeedbackStyle::Medium,
    );
    generator.impactOccurred();
}

// PICTURES OF PAGES

/// Pictures of the pages left, newest last, by path: what a pop slides over.
const KEPT: usize = 8;
/// How far left (a share of the width) the page underneath sits, as UIKit's stack moves it.
const PARALLAX: CGFloat = 0.3;
/// How dark the page underneath is at the start of a pop, or the end of a push.
const DIM: CGFloat = 0.12;
/// How long a push or pop takes.
const SLIDE: f64 = 0.35;
/// The longest a navigation waits for the runtime's next page before it gives up on moving.
const WAIT: Duration = Duration::from_millis(500);
/// After the next page's tree arrives, a frame for Rune to draw it.
const DRAWN: Duration = Duration::from_millis(32);

thread_local! {
    static PICTURES: RefCell<Vec<(String, Retained<UIView>)>> = const { RefCell::new(Vec::new()) };
    /// Where the back chevron on screen leads (a path), if there is one.
    static BACK: RefCell<Option<String>> = const { RefCell::new(None) };
    /// A navigation waiting for its page to be drawn.
    static PENDING: RefCell<Option<Pending>> = const { RefCell::new(None) };
    /// A swipe went back: the picture covers the page until the runtime has drawn it.
    static SWIPED: RefCell<Option<Retained<UIView>>> = const { RefCell::new(None) };
    /// A slide is moving: a navigation in the middle of one changes at once.
    static MOVING: Cell<bool> = const { Cell::new(false) };
    static SWIPE: RefCell<Option<(Retained<UIPanGestureRecognizer>, Retained<SwipeBack>)>> =
        const { RefCell::new(None) };
    /// What the swipe moving now slides over: the picture, and the dim over it.
    static UNDER: RefCell<Option<(Retained<UIView>, Retained<UIView>)>> = const { RefCell::new(None) };
}

struct Pending {
    /// The page left, frozen over the page while the next one is drawn.
    cover: Retained<UIView>,
    from: String,
    back: bool,
    at: Instant,
}

/// The view Rune draws in (the window's root view controller's), which slides.
fn page(mtm: MainThreadMarker) -> Option<Retained<UIView>> {
    window(mtm)?.rootViewController()?.view()
}

/// A picture of what Rune drew last, the islands' views over it included.
fn picture(page: &UIView) -> Option<Retained<UIView>> {
    page.snapshotViewAfterScreenUpdates(false)
}

fn keep(path: &str, view: Retained<UIView>) {
    PICTURES.with_borrow_mut(|pictures| {
        pictures.retain(|(kept, _)| kept != path);
        pictures.push((path.to_string(), view));
        if pictures.len() > KEPT {
            pictures.remove(0);
        }
    });
}

fn picture_of(path: &str) -> Option<Retained<UIView>> {
    PICTURES.with_borrow(|pictures| {
        pictures
            .iter()
            .rev()
            .find(|(kept, _)| kept == path)
            .map(|(_, view)| view.clone())
    })
}

/// The runtime is about to draw another page (`{ from, to, back }`): the page it leaves is
/// pictured, and held over the screen until the next one is drawn and the move decided.
pub fn navigate(mtm: MainThreadMarker, json: &str) {
    let Ok(request) = serde_json::from_str::<Value>(json) else {
        return log("[host] a navigation that is not JSON");
    };
    let (Some(from), back) = (
        request["from"].as_str(),
        request["back"].as_bool() == Some(true),
    ) else {
        return;
    };
    // A swipe already moved the page; a slide still moving lets this one change at once.
    if SWIPED.with_borrow(Option::is_some) || MOVING.get() {
        return;
    }
    let (Some(window), Some(page)) = (window(mtm), page(mtm)) else {
        return;
    };
    let (Some(kept), Some(cover)) = (picture(&page), picture(&page)) else {
        return;
    };
    keep(from, kept);
    finish_pending();
    cover.setFrame(page.frame());
    window.addSubview(&cover);
    PENDING.set(Some(Pending {
        cover,
        from: from.to_string(),
        back,
        at: Instant::now(),
    }));
    // A runtime that draws nothing new still lets the screen go.
    later(WAIT, move || {
        if PENDING.with_borrow(|p| p.as_ref().is_some_and(|p| p.at.elapsed() >= WAIT)) {
            finish_pending();
        }
    });
}

/// A tree from the runtime was applied: once Rune has drawn it, a waiting navigation moves.
pub fn tree_applied() {
    if SWIPED.with_borrow(Option::is_some) {
        later(DRAWN, || {
            if let Some(cover) = SWIPED.take() {
                fade_out(cover);
            }
        });
        return;
    }
    if PENDING.with_borrow(Option::is_none) {
        return;
    }
    later(DRAWN, || {
        let Some(pending) = PENDING.take() else {
            return;
        };
        let Some(mtm) = MainThreadMarker::new() else {
            return;
        };
        // The page drawn now leads back to the one left: it was pushed onto it.
        let pushed = BACK.with_borrow(|back| back.as_deref() == Some(pending.from.as_str()));
        match (page(mtm), pending.back, pushed) {
            (Some(page), true, _) => pop(mtm, page, pending.cover),
            (Some(page), false, true) => push(mtm, page, pending.cover),
            _ => pending.cover.removeFromSuperview(),
        }
    });
}

/// The navigation waiting, if any, changes at once.
fn finish_pending() {
    if let Some(pending) = PENDING.take() {
        pending.cover.removeFromSuperview();
    }
}

fn later(after: Duration, work: impl FnOnce() + Send + 'static) {
    let when = DispatchTime::NOW.time(after.as_nanos() as i64);
    let _ = DispatchQueue::main().after(when, work);
}

fn shifted(x: CGFloat) -> CGAffineTransform {
    CGAffineTransform {
        a: 1.0,
        b: 0.0,
        c: 0.0,
        d: 1.0,
        tx: x,
        ty: 0.0,
    }
}

/// A shadow down the page's left edge, as a pushed page casts on the one under it.
fn shadow(view: &UIView, on: bool) {
    let layer = view.layer();
    layer.setShadowOpacity(if on { 0.25 } else { 0.0 });
    if on {
        let path = UIBezierPath::bezierPathWithRect(view.bounds());
        layer.setShadowRadius(8.0);
        layer.setShadowOffset(CGSize::new(-2.0, 0.0));
        layer.setShadowPath(Some(&path.CGPath()));
    }
}

/// A dim the size of `over`, laid on it.
fn dim_over(mtm: MainThreadMarker, over: &UIView, alpha: CGFloat) -> Retained<UIView> {
    let dim = UIView::initWithFrame(UIView::alloc(mtm), over.bounds());
    dim.setBackgroundColor(Some(&UIColor::blackColor()));
    dim.setAlpha(alpha);
    dim.setUserInteractionEnabled(false);
    over.addSubview(&dim);
    dim
}

fn animate(
    mtm: MainThreadMarker,
    duration: f64,
    moves: impl Fn() + 'static,
    done: impl Fn() + 'static,
) {
    MOVING.set(true);
    let moves = RcBlock::new(moves);
    let done = RcBlock::new(move |_: Bool| {
        MOVING.set(false);
        done();
    });
    // UIKit's own push: a spring with no bounce, as `UINavigationController`'s.
    UIView::animateWithDuration_delay_usingSpringWithDamping_initialSpringVelocity_options_animations_completion(
        duration,
        0.0,
        1.0,
        0.0,
        UIViewAnimationOptions::AllowUserInteraction,
        &moves,
        Some(&done),
        mtm,
    );
}

/// The new page slides in from the right over the old one, which drifts left and dims.
fn push(mtm: MainThreadMarker, page: Retained<UIView>, old: Retained<UIView>) {
    let Some(parent) = page.superview() else {
        return old.removeFromSuperview();
    };
    let width = page.bounds().size.width;
    parent.insertSubview_belowSubview(&old, &page);
    let dim = dim_over(mtm, &old, 0.0);
    page.setTransform(shifted(width));
    shadow(&page, true);
    let (moving, under, dimming) = (page.clone(), old.clone(), dim.clone());
    animate(
        mtm,
        SLIDE,
        move || {
            moving.setTransform(shifted(0.0));
            under.setTransform(shifted(-width * PARALLAX));
            dimming.setAlpha(DIM);
        },
        move || {
            shadow(&page, false);
            old.removeFromSuperview();
        },
    );
}

/// The old page slides off to the right, over the new one coming back from the left.
fn pop(mtm: MainThreadMarker, page: Retained<UIView>, old: Retained<UIView>) {
    let width = page.bounds().size.width;
    let dim = dim_over(mtm, &page, DIM);
    page.setTransform(shifted(-width * PARALLAX));
    shadow(&old, true);
    let (moving, under, dimming) = (old.clone(), page.clone(), dim.clone());
    animate(
        mtm,
        SLIDE,
        move || {
            moving.setTransform(shifted(width));
            under.setTransform(shifted(0.0));
            dimming.setAlpha(0.0);
        },
        move || {
            dim.removeFromSuperview();
            old.removeFromSuperview();
        },
    );
}

fn fade_out(cover: Retained<UIView>) {
    let Some(mtm) = MainThreadMarker::new() else {
        return;
    };
    let fading = cover.clone();
    let fade = RcBlock::new(move || fading.setAlpha(0.0));
    let done = RcBlock::new(move |_: Bool| cover.removeFromSuperview());
    UIView::animateWithDuration_animations_completion(0.12, &fade, Some(&done), mtm);
}

// SWIPE BACK

/// A swipe starts this close (points) to the left edge, as a navigation stack's does.
const EDGE: CGFloat = 24.0;
/// A swipe let go past this share of the width goes back; short of it, the page returns.
const COMMIT_SHARE: CGFloat = 0.35;
/// A flick this fast (points per second) goes back however short.
const COMMIT_VELOCITY: CGFloat = 500.0;

/// Where the back chevron on screen leads (a path); empty when there is none. The edge swipe is
/// on while there is one.
pub fn set_swipe_back(mtm: MainThreadMarker, path: &str) {
    BACK.set((!path.is_empty()).then(|| path.to_string()));
    let enabled = !path.is_empty();
    if SWIPE.with_borrow(Option::is_none) {
        if !enabled {
            return;
        }
        let Some(window) = window(mtm) else {
            return;
        };
        let target: Retained<SwipeBack> = {
            let this = SwipeBack::alloc(mtm).set_ivars(());
            unsafe { msg_send![super(this), init] }
        };
        // A pan that only begins at the edge (`gestureRecognizerShouldBegin:`), rather than
        // UIKit's edge recognizer, which ignores the touches XCTest makes up.
        // SAFETY: the target is kept alive beside the recognizer, and answers `pan:`.
        let swipe = unsafe {
            UIPanGestureRecognizer::initWithTarget_action(
                UIPanGestureRecognizer::alloc(mtm),
                Some(&target),
                Some(sel!(pan:)),
            )
        };
        swipe.setDelegate(Some(ProtocolObject::from_ref(&*target)));
        window.addGestureRecognizer(&swipe);
        // Behind a page with nothing pictured under it.
        window.setBackgroundColor(Some(&UIColor::blackColor()));
        SWIPE.set(Some((swipe, target)));
    }
    SWIPE.with_borrow(|swipe| {
        if let Some((swipe, _)) = swipe {
            swipe.setEnabled(enabled);
        }
    });
}

/// The swipe began: the page it goes back to, pictured, slides in underneath.
fn begin_swipe(mtm: MainThreadMarker, page: &UIView) {
    finish_pending();
    let Some(parent) = page.superview() else {
        return;
    };
    let under = BACK
        .with_borrow(Clone::clone)
        .and_then(|path| picture_of(&path));
    if let Some(under) = under {
        under.setFrame(page.frame());
        under.setAlpha(1.0);
        parent.insertSubview_belowSubview(&under, page);
        let dim = dim_over(mtm, &under, DIM);
        UNDER.set(Some((under, dim)));
    }
    shadow(page, true);
}

/// The swipe moved the page `progress` of the way across.
fn follow(page: &UIView, moved: CGFloat, width: CGFloat) {
    page.setTransform(shifted(moved));
    let progress = moved / width;
    UNDER.with_borrow(|under| {
        if let Some((under, dim)) = under {
            under.setTransform(shifted(-width * PARALLAX * (1.0 - progress)));
            dim.setAlpha(DIM * (1.0 - progress));
        }
    });
}

/// Let go short: the page returns, and what was under it goes.
fn settle(mtm: MainThreadMarker, page: Retained<UIView>, width: CGFloat) {
    let moving = page.clone();
    let under = UNDER.with_borrow(Clone::clone);
    let moved_under = under.clone();
    animate(
        mtm,
        0.3,
        move || {
            moving.setTransform(shifted(0.0));
            if let Some((under, dim)) = &moved_under {
                under.setTransform(shifted(-width * PARALLAX));
                dim.setAlpha(DIM);
            }
        },
        move || {
            shadow(&page, false);
            if let Some((under, dim)) = &under {
                dim.removeFromSuperview();
                under.removeFromSuperview();
            }
            UNDER.set(None);
        },
    );
}

/// Let go far or fast: the page slides off, and the app goes back. The picture of the page it
/// goes to covers the screen until the runtime has drawn it (`tree_applied`).
fn slide_off(mtm: MainThreadMarker, page: Retained<UIView>, width: CGFloat) {
    let moving = page.clone();
    let under = UNDER.take();
    let moved_under = under.clone();
    animate(
        mtm,
        0.25,
        move || {
            moving.setTransform(shifted(width));
            if let Some((under, dim)) = &moved_under {
                under.setTransform(shifted(0.0));
                dim.setAlpha(0.0);
            }
        },
        move || {
            shadow(&page, false);
            if let Some((under, dim)) = &under {
                dim.removeFromSuperview();
                if let Some(parent) = under.superview() {
                    parent.bringSubviewToFront(under);
                }
                SWIPED.set(Some(under.clone()));
            }
            page.setTransform(shifted(0.0));
            reply(&serde_json::json!({ "back": true }));
            // Nothing pictured: the page comes back as soon as it moved.
            if under.is_none() {
                page.setAlpha(0.0);
                let shown = page.clone();
                let fade_in = RcBlock::new(move || shown.setAlpha(1.0));
                if let Some(mtm) = MainThreadMarker::new() {
                    UIView::animateWithDuration_delay_options_animations_completion(
                        0.18,
                        0.06,
                        UIViewAnimationOptions::CurveEaseOut,
                        &fade_in,
                        None,
                        mtm,
                    );
                }
            }
        },
    );
}

define_class!(
    // SAFETY: NSObject has no subclassing requirements; the class does not implement `Drop`.
    #[unsafe(super(NSObject))]
    #[thread_kind = MainThreadOnly]
    #[name = "HazelSwipeBack"]
    /// Moves the page with the edge swipe, and goes back when it is let go far or fast enough.
    struct SwipeBack;

    unsafe impl NSObjectProtocol for SwipeBack {}

    unsafe impl UIGestureRecognizerDelegate for SwipeBack {
        /// Only a drag from the left edge that heads right more than it climbs or falls, while
        /// no slide is moving.
        #[unsafe(method(gestureRecognizerShouldBegin:))]
        fn should_begin(&self, recognizer: &UIGestureRecognizer) -> Bool {
            let Some(swipe) = recognizer.downcast_ref::<UIPanGestureRecognizer>() else {
                return Bool::NO;
            };
            let Some(window) = window(self.mtm()) else {
                return Bool::NO;
            };
            let (at, moved) = (
                swipe.locationInView(Some(&window)),
                swipe.translationInView(Some(&window)),
            );
            let velocity = swipe.velocityInView(Some(&window));
            Bool::new(
                !MOVING.get()
                    && at.x - moved.x <= EDGE
                    && velocity.x > 0.0
                    && velocity.x > velocity.y.abs(),
            )
        }
    }

    impl SwipeBack {
        #[unsafe(method(pan:))]
        fn pan(&self, swipe: &UIPanGestureRecognizer) {
            let mtm = self.mtm();
            let (Some(window), Some(page)) = (window(mtm), page(mtm)) else {
                return;
            };
            let width = window.bounds().size.width;
            let moved = swipe.translationInView(Some(&window)).x.clamp(0.0, width);
            // UIGestureRecognizerState: 1 began, 2 changed, 3 ended, 4 cancelled, 5 failed.
            let state: isize = unsafe { msg_send![swipe, state] };
            match state {
                1 => {
                    begin_swipe(mtm, &page);
                    follow(&page, moved, width);
                }
                2 => follow(&page, moved, width),
                3 => {
                    let velocity = swipe.velocityInView(Some(&window)).x;
                    let back = velocity > COMMIT_VELOCITY
                        || (moved > width * COMMIT_SHARE && velocity > -COMMIT_VELOCITY);
                    if back {
                        slide_off(mtm, page, width);
                    } else {
                        settle(mtm, page, width);
                    }
                }
                _ => settle(mtm, page, width),
            }
        }
    }
);
