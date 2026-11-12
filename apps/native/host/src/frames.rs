//! `<iframe>`s (HTML renders): the host shows each one's page in a web view laid over the box
//! Rune draws for it, and passes what the page posts to its parent on to the runtime.
//!
//! The web view is a native view above Rune's own drawing, so after every frame it is put where
//! its box was drawn (`sync`): clipped as the box's ancestors clip it (a scrolling list, a
//! collapsed render), cut out where a menu or toolbar is drawn over it, and hidden under a
//! dialog it is not in.
//!
//! The page keeps the web app's isolation: it runs in a sandboxed frame of a page of ours
//! (`wrapper_html`), never as the web view's own document, so it cannot navigate the view or reach
//! the bridge to the host.
use std::sync::Arc;

use crate::wire::Node;

/// An `<iframe>` in the tree.
#[derive(Debug, Clone, PartialEq)]
pub struct FrameSpec {
    /// The element's path, which is also its Rune key.
    pub path: String,
    pub src: String,
    /// The ancestors that clip it (`overflow: hidden`, scroll viewports), by path.
    pub clips: Vec<String>,
    /// The portal it is drawn in (a dialog), by path; `None` in the page itself.
    pub layer: Option<String>,
}

/// The frames of a tree, in document order.
pub fn collect(root: &Arc<Node>) -> Vec<FrameSpec> {
    let mut out = Vec::new();
    walk(root, "r", None, &mut Vec::new(), &mut out);
    out
}

/// Collects the frames under `node`, with the portal they are in (`layer`) and the clipping
/// ancestors met on the way down (`clips`).
fn walk(
    node: &Arc<Node>,
    path: &str,
    layer: Option<&str>,
    clips: &mut Vec<String>,
    out: &mut Vec<FrameSpec>,
) {
    let Node::Elem {
        tag,
        st,
        attrs,
        children,
        ..
    } = node.as_ref()
    else {
        return;
    };
    if st.display.as_deref() == Some("none") {
        return;
    }
    // A portal draws at the window's root: what clips the place it left does not clip it.
    let portal = crate::is_portal(node);
    let layer = if portal { Some(path) } else { layer };
    if tag == "iframe" {
        if let Some(src) = attrs.get("src").filter(|src| !src.is_empty()) {
            out.push(FrameSpec {
                path: path.to_string(),
                src: src.clone(),
                clips: clips.clone(),
                layer: layer.map(str::to_string),
            });
        }
        return;
    }
    let mut own_clips = Vec::new();
    let clips = if portal { &mut own_clips } else { clips };
    let clipping =
        st.scroll_y == Some(true) || st.clip == Some(true) || crate::layout::scrolls_x(st);
    if clipping {
        clips.push(path.to_string());
    }
    for (i, child) in children.iter().enumerate() {
        walk(child, &crate::child_path(path, i, child), layer, clips, out);
    }
    if clipping {
        clips.pop();
    }
}

/// A box drawn over the page's own content: a dialog, what a menu, a popover or the message
/// toolbar paints, or a sticky element (a list's pinned date).
#[derive(Debug, Clone, PartialEq)]
pub struct CoverSpec {
    pub path: String,
    /// A dialog: it takes the whole window from the page behind it.
    pub modal: bool,
    /// A sticky element, and the portal it scrolls in (`None` for the page): it is over the
    /// frames of that layer only, and under a dialog or menu drawn above it. `None` for an
    /// overlay, which is over everything.
    pub sticky_in: Option<Option<String>>,
}

impl CoverSpec {
    /// Whether it is drawn over the frame `frame`.
    pub fn is_over(&self, frame: &FrameSpec) -> bool {
        // The dialog a frame is in is not over it.
        let inside = frame
            .path
            .strip_prefix(self.path.as_str())
            .is_some_and(|rest| rest.starts_with('/'));
        !inside
            && self
                .sticky_in
                .as_ref()
                .is_none_or(|layer| *layer == frame.layer)
    }
}

/// What is drawn over a frame's box: the overlays among `portals`, and the sticky elements of
/// the tree, which stay put while a frame scrolls under them. A dialog covers as a whole.
/// Anything else covers where it paints: its outermost boxes with a background, since the
/// element that places a menu is often an empty layer as large as the window.
pub fn collect_covers(root: &Arc<Node>, portals: &[(String, Arc<Node>)]) -> Vec<CoverSpec> {
    let mut out = Vec::new();
    sticky(root, "r", None, &mut out);
    for (path, node) in portals {
        let Node::Elem { ov: Some(ov), .. } = node.as_ref() else {
            // A fixed element with no overlay of its own is part of the page.
            continue;
        };
        if ov.portal.is_none() {
            continue;
        }
        if ov.modal.is_some() {
            out.push(CoverSpec {
                path: path.clone(),
                modal: true,
                sticky_in: None,
            });
        } else {
            painted(node, path, None, &mut out);
        }
    }
    out
}

/// The sticky elements under `node`, as what they paint: a frame of the same layer (`layer`,
/// the portal they are in) scrolls under them.
fn sticky(node: &Arc<Node>, path: &str, layer: Option<&str>, out: &mut Vec<CoverSpec>) {
    let Node::Elem { st, children, .. } = node.as_ref() else {
        return;
    };
    if st.display.as_deref() == Some("none") {
        return;
    }
    let layer = if crate::is_portal(node) {
        Some(path)
    } else {
        layer
    };
    if st.sticky_top.is_some() {
        painted(node, path, Some(layer.map(str::to_string)), out);
        return;
    }
    for (i, child) in children.iter().enumerate() {
        sticky(child, &crate::child_path(path, i, child), layer, out);
    }
}

/// The outermost boxes under `node` that have a background: where an overlay is seen, and so
/// where it covers. What such a box holds is inside it and adds nothing.
fn painted(
    node: &Arc<Node>,
    path: &str,
    sticky_in: Option<Option<String>>,
    out: &mut Vec<CoverSpec>,
) {
    let Node::Elem { st, children, .. } = node.as_ref() else {
        return;
    };
    if st.display.as_deref() == Some("none") {
        return;
    }
    if crate::layout::color(&st.bg).is_some() || st.bg_image.is_some() {
        out.push(CoverSpec {
            path: path.to_string(),
            modal: false,
            sticky_in,
        });
        return;
    }
    for (i, child) in children.iter().enumerate() {
        painted(
            child,
            &crate::child_path(path, i, child),
            sticky_in.clone(),
            out,
        );
    }
}

type Rect = [f32; 4];

/// The part two rects share; a rect with no width or height when they do not meet.
fn intersect(a: Rect, b: Rect) -> Rect {
    let x = a[0].max(b[0]);
    let y = a[1].max(b[1]);
    let right = (a[0] + a[2]).min(b[0] + b[2]);
    let bottom = (a[1] + a[3]).min(b[1] + b[3]);
    [x, y, (right - x).max(0.0), (bottom - y).max(0.0)]
}

/// Nothing of the rect can show.
fn is_empty(r: Rect) -> bool {
    r[2] <= 0.0 || r[3] <= 0.0
}

/// A `CoverSpec` as the last frame drew it.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Cover {
    pub rect: Rect,
    /// It takes the whole window from the page behind it (a dialog and its backdrop).
    pub modal: bool,
}

/// Where a frame's web view goes, in window points from the top left.
#[derive(Debug, Clone, PartialEq)]
pub struct Placement {
    /// The whole page's box, which may reach outside `visible`.
    pub rect: Rect,
    /// The part of `rect` its ancestors let show.
    pub visible: Rect,
    /// Parts of `visible` something else is drawn over: the view neither shows nor takes
    /// presses there.
    pub holes: Vec<Rect>,
    pub opacity: f32,
}

/// What a frame's view is cut from where something is drawn over it: the size of the part that
/// shows, and the holes in it, from that part's top left. A mask is as large as what it was
/// made for, so one made for a smaller part hides the rest of a part that grew.
#[derive(Debug, Clone, PartialEq)]
pub struct MaskShape {
    pub size: [f32; 2],
    pub holes: Vec<Rect>,
}

impl Placement {
    /// The mask the view needs; none when nothing is drawn over it.
    pub fn mask(&self) -> Option<MaskShape> {
        let [vx, vy, width, height] = self.visible;
        (!self.holes.is_empty()).then(|| MaskShape {
            size: [width, height],
            holes: self
                .holes
                .iter()
                .map(|[x, y, w, h]| [x - vx, y - vy, *w, *h])
                .collect(),
        })
    }
}

/// The web view's place for a box drawn at `rect`; `None` when none of it shows (clipped away,
/// or under a dialog). A box with no opacity keeps its place: its page loads before it shows.
pub fn place(rect: Rect, opacity: f32, clips: &[Rect], covers: &[Cover]) -> Option<Placement> {
    if covers.iter().any(|cover| cover.modal) {
        return None;
    }
    let visible = clips
        .iter()
        .fold(rect, |visible, clip| intersect(visible, *clip));
    if is_empty(visible) {
        return None;
    }
    let holes = covers
        .iter()
        .map(|cover| intersect(visible, cover.rect))
        .filter(|hole| !is_empty(*hole))
        .collect();
    Some(Placement {
        rect,
        visible,
        holes,
        opacity,
    })
}

/// What the wrapper page tells the host (`wrapper_html`'s script).
#[derive(serde::Deserialize)]
#[serde(tag = "k", rename_all = "lowercase")]
// Read by the web views on Apple platforms only.
#[cfg_attr(not(target_vendor = "apple"), allow(dead_code))]
enum PageEvent {
    Load,
    Message {
        data: serde_json::Value,
        #[serde(default)]
        active: bool,
    },
}

/// The line for the runtime, for what the wrapper page of the frame at `path` posted.
// Read by the web views on Apple platforms only.
#[cfg_attr(not(target_vendor = "apple"), allow(dead_code))]
fn runtime_message(path: &str, body: &str) -> Option<serde_json::Value> {
    match serde_json::from_str::<PageEvent>(body).ok()? {
        PageEvent::Load => Some(serde_json::json!({ "t": "frame", "path": path, "event": "load" })),
        PageEvent::Message { data, active } => Some(serde_json::json!({
            "t": "frame", "path": path, "event": "message", "data": data, "active": active,
        })),
    }
}

/// `value` for a double-quoted HTML attribute.
fn escape_attribute(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('"', "&quot;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

/// `scheme://host[:port]` of an http(s) URL: the one origin the wrapper may frame.
fn origin_of(url: &str) -> Option<&str> {
    let scheme_end = url.find("://")?;
    if !matches!(&url[..scheme_end], "http" | "https") {
        return None;
    }
    let rest = &url[scheme_end + 3..];
    let host_end = rest.find(['/', '?', '#']).unwrap_or(rest.len());
    let origin = &url[..scheme_end + 3 + host_end];
    // The origin goes into a CSP: nothing that could end the directive or the attribute.
    (host_end > 0
        && origin
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b":/.-[]".contains(&b)))
    .then_some(origin)
}

/// The app's appearance, as the frame's URL carries it (`htmlRenderThemeFragment`).
fn is_light(src: &str) -> bool {
    src.contains("%22appearance%22%3A%22light%22")
}

/// A fullscreen frame scrolls its own page; an inline one leaves the wheel to the app's list.
// Read by the web views on Apple platforms only.
#[cfg_attr(not(target_vendor = "apple"), allow(dead_code))]
fn scrolls_itself(src: &str) -> bool {
    src.contains("hazel-display=fullscreen")
}

/// The web view's own document: the page in a sandboxed frame, as the web app frames it
/// (`sandbox="allow-scripts"`, no referrer), and the script that stands between that frame and
/// the host. `None` for a `src` that is not an http(s) URL.
///
/// The frame's canvas stays transparent only while its colour scheme matches the page's, so the
/// wrapper follows the theme the app posts. Its viewport is the view's width, or iOS lays the
/// page out for a desktop's and scales it down.
pub fn wrapper_html(src: &str) -> Option<String> {
    let origin = origin_of(src)?;
    let scheme = if is_light(src) { "light" } else { "dark" };
    Some(format!(
        r#"<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-src {origin}"><style>html,body{{margin:0;height:100%;overflow:hidden;background:transparent}}iframe{{display:block;width:100%;height:100%;border:0;background:transparent;color-scheme:{scheme}}}</style></head><body><iframe id="f" sandbox="allow-scripts" referrerpolicy="no-referrer" src="{src}"></iframe><script>(function(){{var f=document.getElementById("f"),h=window.webkit.messageHandlers.hazel;function s(m){{h.postMessage(JSON.stringify(m));}}f.addEventListener("load",function(){{s({{k:"load"}});}});window.addEventListener("message",function(e){{if(e.source!==f.contentWindow)return;var u=navigator.userActivation;try{{s({{k:"message",data:e.data,active:document.activeElement===f&&!!(u&&u.isActive)}});}}catch(x){{}}}});window.__hazelPost=function(m){{var t=m&&m.params&&m.params.theme;if(t==="light"||t==="dark")f.style.colorScheme=t;f.contentWindow.postMessage(m,"*");}};}})();</script></body></html>"#,
        origin = origin,
        scheme = scheme,
        src = escape_attribute(src),
    ))
}

/// Puts every frame's web view where its box was drawn in the frame just presented.
pub fn sync(runtime: &rune::Runtime<crate::State>) {
    let state = &runtime.state;
    if state.frames.is_empty() && !views::any() {
        return;
    }
    let rect_of = |path: &str| runtime.presented(path).map(|(rect, _)| rect);
    let placed: Vec<(&FrameSpec, Option<Placement>)> = state
        .frames
        .iter()
        .map(|frame| {
            let Some((rect, opacity)) = runtime.presented(&frame.path) else {
                return (frame, None);
            };
            let clips: Vec<Rect> = frame
                .clips
                .iter()
                .filter_map(|path| rect_of(path))
                .collect();
            let covers: Vec<Cover> = state
                .covers
                .iter()
                .filter(|cover| cover.is_over(frame))
                .filter_map(|cover| {
                    let rect = rect_of(&cover.path);
                    Some(Cover {
                        // A dialog covers wherever it is drawn.
                        rect: if cover.modal {
                            rect.unwrap_or_default()
                        } else {
                            rect?
                        },
                        modal: cover.modal,
                    })
                })
                .collect();
            (frame, place(rect, opacity, &clips, &covers))
        })
        .collect();
    views::apply(&placed);
}

/// `contentWindow.postMessage(data)` on the frame at `path`.
pub fn post(path: &str, data: &serde_json::Value) {
    views::post(path, data);
}

/// No web view on this platform: frames keep their boxes and show nothing.
#[cfg(not(target_vendor = "apple"))]
mod views {
    use super::{FrameSpec, Placement};

    pub fn any() -> bool {
        false
    }
    pub fn apply(_: &[(&FrameSpec, Option<Placement>)]) {}
    pub fn post(_: &str, _: &serde_json::Value) {}
}

/// The frames' web views on macOS and iOS: a `WKWebView` each, inside a host view that clips it
/// and is cut out where something else is drawn over it. What differs between AppKit and UIKit
/// lives in `platform`.
#[cfg(target_vendor = "apple")]
mod views {
    use std::cell::RefCell;
    use std::collections::HashMap;

    use objc2::rc::Retained;
    use objc2::{DefinedClass, MainThreadMarker, MainThreadOnly, define_class, msg_send};
    use objc2_core_foundation::{CGPoint, CGRect, CGSize};
    use objc2_core_graphics::CGMutablePath;
    use objc2_foundation::{NSObject, NSObjectProtocol, NSString};
    use objc2_quartz_core::{CALayer, CAShapeLayer, kCAFillRuleEvenOdd};
    use objc2_web_kit::{WKScriptMessage, WKScriptMessageHandler, WKUserContentController};

    use super::platform::FrameView;
    use super::{FrameSpec, MaskShape, Placement, Rect};

    /// A Rune rect (`[x, y, w, h]`, from the top left) as Core Graphics'. The host views are
    /// flipped on macOS, so both platforms place from the top left.
    pub(super) fn cg(rect: Rect) -> CGRect {
        CGRect::new(
            CGPoint::new(rect[0] as f64, rect[1] as f64),
            CGSize::new(rect[2] as f64, rect[3] as f64),
        )
    }

    /// Whether `[x, y]`, from the host's top left, is in one of the mask's holes.
    pub(super) fn in_hole(mask: Option<&MaskShape>, [x, y]: [f32; 2]) -> bool {
        mask.is_some_and(|mask| {
            mask.holes
                .iter()
                .any(|[hx, hy, hw, hh]| x >= *hx && x < hx + hw && y >= *hy && y < hy + hh)
        })
    }

    /// Cuts the holes out of the host's layer: everything but the holes shows. With the
    /// even-odd rule a rect inside the outer one is cut out.
    pub(super) fn set_mask(layer: &CALayer, mask: Option<&MaskShape>) {
        let Some(shape) = mask else {
            unsafe { layer.setMask(None) };
            return;
        };
        let path = CGMutablePath::new();
        let outer = cg([0.0, 0.0, shape.size[0], shape.size[1]]);
        unsafe {
            CGMutablePath::add_rect(Some(&path), std::ptr::null(), outer);
            for hole in &shape.holes {
                CGMutablePath::add_rect(Some(&path), std::ptr::null(), cg(*hole));
            }
        }
        let layer_mask = CAShapeLayer::new();
        layer_mask.setFrame(outer);
        layer_mask.setFillRule(unsafe { kCAFillRuleEvenOdd });
        layer_mask.setPath(Some(&path));
        unsafe { layer.setMask(Some(&layer_mask)) };
    }

    pub(super) struct MessagesIvars {
        path: String,
    }

    define_class!(
        // SAFETY: NSObject has no subclassing requirements; the class does not implement `Drop`.
        #[unsafe(super(NSObject))]
        #[thread_kind = MainThreadOnly]
        #[name = "HazelFrameMessages"]
        #[ivars = MessagesIvars]
        /// What a frame's wrapper page posts to the host.
        pub(super) struct FrameMessages;

        unsafe impl NSObjectProtocol for FrameMessages {}

        unsafe impl WKScriptMessageHandler for FrameMessages {
            /// The wrapper page's `load` and the framed page's messages, on to the runtime.
            #[unsafe(method(userContentController:didReceiveScriptMessage:))]
            fn did_receive(
                &self,
                _controller: &WKUserContentController,
                message: &WKScriptMessage,
            ) {
                // The handler exists in every frame of the view: only the wrapper is ours. The
                // framed page reaches the app through `postMessage` to the wrapper, which says
                // whose window a message came from.
                if !unsafe { message.frameInfo().isMainFrame() } {
                    return;
                }
                let body = unsafe { message.body() };
                let Some(body) = body.downcast_ref::<NSString>() else {
                    return;
                };
                if let Some(line) = super::runtime_message(&self.ivars().path, &body.to_string()) {
                    crate::outbox::write_line(line);
                }
            }
        }
    );

    impl FrameMessages {
        pub(super) fn new(mtm: MainThreadMarker, path: &str) -> Retained<Self> {
            let this = Self::alloc(mtm).set_ivars(MessagesIvars {
                path: path.to_string(),
            });
            unsafe { msg_send![super(this), init] }
        }
    }

    /// The wrapper page for `src`; `None` (and nothing loads) for a `src` it refuses.
    pub(super) fn wrapper(src: &str) -> Option<Retained<NSString>> {
        let Some(html) = super::wrapper_html(src) else {
            eprintln!("[host] a frame's src is not an http(s) URL");
            return None;
        };
        Some(NSString::from_str(&html))
    }

    struct Entry {
        view: FrameView,
        src: String,
    }

    thread_local! {
        static VIEWS: RefCell<HashMap<String, Entry>> = RefCell::new(HashMap::new());
    }

    /// Whether any web view exists: with none and no frame in the tree, a drawn frame has nothing to place.
    pub fn any() -> bool {
        VIEWS.with_borrow(|views| !views.is_empty())
    }

    /// Brings the web views in line with the frames of the tree just drawn: removes the ones whose
    /// frame is gone, creates the ones that are new, reloads a changed `src`, and places each.
    pub fn apply(placed: &[(&FrameSpec, Option<Placement>)]) {
        let Some(mtm) = MainThreadMarker::new() else {
            return;
        };
        VIEWS.with_borrow_mut(|views| {
            views.retain(|path, entry| {
                let keep = placed.iter().any(|(frame, _)| frame.path == *path);
                if !keep {
                    entry.view.remove();
                }
                keep
            });
            for (frame, placement) in placed {
                // A page that turns from inline to fullscreen or back gets a new view: some of
                // what differs (iOS's text selection) is set only when a web view is made.
                let mode_changed = views.get(&frame.path).is_some_and(|entry| {
                    super::scrolls_itself(&entry.src) != super::scrolls_itself(&frame.src)
                });
                if mode_changed && let Some(entry) = views.remove(&frame.path) {
                    entry.view.remove();
                }
                if !views.contains_key(&frame.path) {
                    // A frame nothing shows of yet still loads, as a browser's does; one under
                    // a dialog waits until it is uncovered.
                    if placement.is_none() {
                        continue;
                    }
                    let Some(view) = FrameView::create(mtm, frame) else {
                        continue;
                    };
                    view.load(&frame.src);
                    views.insert(
                        frame.path.clone(),
                        Entry {
                            view,
                            src: frame.src.clone(),
                        },
                    );
                }
                let Some(entry) = views.get_mut(&frame.path) else {
                    continue;
                };
                if entry.src != frame.src {
                    entry.src = frame.src.clone();
                    entry.view.load(&frame.src);
                }
                match placement {
                    Some(placement) => entry.view.put(placement),
                    None => entry.view.hide(),
                }
            }
        });
    }

    /// Hands `data` to the wrapper page of the frame at `path`, which posts it to the framed page.
    pub fn post(path: &str, data: &serde_json::Value) {
        VIEWS.with_borrow(|views| {
            if let Some(entry) = views.get(path) {
                entry
                    .view
                    .evaluate(&format!("window.__hazelPost&&window.__hazelPost({data})"));
            }
        });
    }
}

/// AppKit: the web views go in the app window's own view, which Rune draws in.
#[cfg(target_os = "macos")]
mod platform {
    use std::cell::{Cell, RefCell};

    use objc2::rc::Retained;
    use objc2::runtime::ProtocolObject;
    use objc2::{DefinedClass, MainThreadMarker, MainThreadOnly, define_class, msg_send};
    use objc2_app_kit::{NSApplication, NSColor, NSEvent, NSView};
    use objc2_core_foundation::CGPoint;
    use objc2_foundation::{NSNumber, NSObject, NSString, ns_string};
    use objc2_web_kit::{WKWebView, WKWebViewConfiguration, WKWebsiteDataStore};

    use super::views::{FrameMessages, cg, in_hole, set_mask, wrapper};
    use super::{FrameSpec, MaskShape, Placement};

    struct HostIvars {
        /// The mask on the view now: where something else is drawn over it.
        mask: RefCell<Option<MaskShape>>,
        /// Not shown yet (its box has no opacity): presses go to what is behind.
        passes_presses: Cell<bool>,
    }

    define_class!(
        // SAFETY: NSView has no subclassing requirements beyond the main thread, and the class
        // does not implement `Drop`.
        #[unsafe(super(NSView))]
        #[thread_kind = MainThreadOnly]
        #[name = "HazelFrameHost"]
        #[ivars = HostIvars]
        /// The part of a frame's box that shows: it clips the web view inside it.
        struct FrameHost;

        impl FrameHost {
            // Top left origin, as Rune's rects and the window's own view have it.
            #[unsafe(method(isFlipped))]
            fn is_flipped(&self) -> bool {
                true
            }

            /// No view where the frame is not shown yet or something else is drawn over it: the
            /// press goes to the window's own view behind, which is Rune's.
            #[unsafe(method(hitTest:))]
            fn hit_test(&self, point: CGPoint) -> *mut NSView {
                let ivars = self.ivars();
                if ivars.passes_presses.get() {
                    return std::ptr::null_mut();
                }
                // `point` is in the superview's coordinates.
                let own = self.convertPoint_fromView(point, unsafe { self.superview() }.as_deref());
                if in_hole(ivars.mask.borrow().as_ref(), [own.x as f32, own.y as f32]) {
                    return std::ptr::null_mut();
                }
                unsafe { msg_send![super(self), hitTest: point] }
            }
        }
    );

    struct WebIvars {
        /// The page scrolls in the view (a fullscreen frame); otherwise the wheel is the app's.
        scrolls_itself: Cell<bool>,
    }

    define_class!(
        // SAFETY: WKWebView may be subclassed; the class does not implement `Drop`.
        #[unsafe(super(WKWebView, NSView, objc2_app_kit::NSResponder, NSObject))]
        #[thread_kind = MainThreadOnly]
        #[name = "HazelFrameWebView"]
        #[ivars = WebIvars]
        struct FrameWebView;

        impl FrameWebView {
            // An inline page is as tall as its frame and never scrolls, but the web view would
            // still take the wheel: it goes on to the window's view, so the list under the
            // pointer scrolls.
            #[unsafe(method(scrollWheel:))]
            fn scroll_wheel(&self, event: &NSEvent) {
                if self.ivars().scrolls_itself.get() {
                    let _: () = unsafe { msg_send![super(self), scrollWheel: event] };
                } else if let Some(next) = unsafe { self.nextResponder() } {
                    next.scrollWheel(event);
                }
            }
        }
    );

    pub(super) struct FrameView {
        host: Retained<FrameHost>,
        web: Retained<FrameWebView>,
    }

    /// The app window's own view, which Rune draws in. The app has one window that can be a
    /// main window; anything else Rune opens (a popup, a panel) cannot.
    fn window_view(mtm: MainThreadMarker) -> Option<Retained<NSView>> {
        let app = NSApplication::sharedApplication(mtm);
        let windows = app.windows();
        windows
            .iter()
            .filter(|window| window.isVisible() && window.canBecomeMainWindow())
            .find_map(|window| window.contentView())
    }

    impl FrameView {
        /// A frame's views, hidden in the window until placed: the clipping host, and in it the
        /// web view with its bridge to the runtime, a store of its own and no background.
        pub(super) fn create(mtm: MainThreadMarker, frame: &FrameSpec) -> Option<Self> {
            let parent = window_view(mtm)?;
            let host: Retained<FrameHost> = {
                let this = FrameHost::alloc(mtm).set_ivars(HostIvars {
                    mask: RefCell::new(None),
                    passes_presses: Cell::new(true),
                });
                unsafe { msg_send![super(this), initWithFrame: cg([0.0; 4])] }
            };
            host.setWantsLayer(true);
            if let Some(layer) = host.layer() {
                layer.setMasksToBounds(true);
            }

            let configuration = unsafe { WKWebViewConfiguration::new(mtm) };
            // Nothing a page's assets store (cookies, caches) outlives the app or is shared with
            // anything else that keeps web data.
            unsafe {
                configuration.setWebsiteDataStore(&WKWebsiteDataStore::nonPersistentDataStore(mtm));
            }
            let messages = FrameMessages::new(mtm, &frame.path);
            unsafe {
                configuration
                    .userContentController()
                    .addScriptMessageHandler_name(
                        ProtocolObject::from_ref(&*messages),
                        ns_string!("hazel"),
                    );
            }
            let web: Retained<FrameWebView> = {
                let this = FrameWebView::alloc(mtm).set_ivars(WebIvars {
                    scrolls_itself: Cell::new(false),
                });
                unsafe {
                    msg_send![super(this), initWithFrame: cg([0.0; 4]), configuration: &*configuration]
                }
            };
            // The page sits on the channel's background, drawn by Rune under the view.
            // `drawsBackground` is the web view's own switch for it, set by key as there is no property.
            unsafe {
                let no = NSNumber::new_bool(false);
                let _: () = msg_send![&*web, setValue: &*no, forKey: ns_string!("drawsBackground")];
                web.setUnderPageBackgroundColor(Some(&NSColor::clearColor()));
            }
            host.addSubview(&web);
            host.setHidden(true);
            parent.addSubview(&host);
            Some(Self { host, web })
        }

        pub(super) fn load(&self, src: &str) {
            let Some(html) = wrapper(src) else {
                return;
            };
            self.web
                .ivars()
                .scrolls_itself
                .set(super::scrolls_itself(src));
            unsafe { self.web.loadHTMLString_baseURL(&html, None) };
        }

        /// The host shows `visible`; the web view inside keeps the whole box, so the page does
        /// not reflow as it scrolls under a clip.
        pub(super) fn put(&self, placement: &Placement) {
            let [vx, vy, ..] = placement.visible;
            let host_frame = cg(placement.visible);
            if self.host.frame() != host_frame {
                self.host.setFrame(host_frame);
            }
            let [x, y, w, h] = placement.rect;
            let web_frame = cg([x - vx, y - vy, w, h]);
            if self.web.frame() != web_frame {
                self.web.setFrame(web_frame);
            }
            let shown = placement.opacity > 0.0;
            self.host.ivars().passes_presses.set(!shown);
            self.host.setAlphaValue(placement.opacity as f64);
            self.host.setHidden(false);

            // Rebuilt when the holes move and when the part that shows changes size.
            let mask = placement.mask();
            if *self.host.ivars().mask.borrow() == mask {
                return;
            }
            if let Some(layer) = self.host.layer() {
                set_mask(&layer, mask.as_ref());
            }
            *self.host.ivars().mask.borrow_mut() = mask;
        }

        pub(super) fn hide(&self) {
            self.host.setHidden(true);
        }

        /// Takes the views out of the window; the bridge goes first, as the web view's content
        /// controller would otherwise keep it, and the frame's path, alive.
        pub(super) fn remove(&self) {
            unsafe {
                self.web
                    .configuration()
                    .userContentController()
                    .removeAllScriptMessageHandlers();
            }
            self.host.removeFromSuperview();
        }

        pub(super) fn evaluate(&self, script: &str) {
            unsafe {
                self.web
                    .evaluateJavaScript_completionHandler(&NSString::from_str(script), None)
            };
        }
    }
}

/// UIKit: the web views go in the window, over the view Rune draws in (its root view
/// controller's). A finger on an inline page also reaches Rune's view (`TouchForwarder`), so
/// the list it is in scrolls under the finger as it does anywhere else.
#[cfg(target_os = "ios")]
mod platform {
    use std::cell::{Cell, RefCell};

    use objc2::rc::{Retained, Weak};
    use objc2::runtime::{AnyObject, ProtocolObject};
    use objc2::{
        DefinedClass, MainThreadMarker, MainThreadOnly, define_class, extern_class, msg_send,
    };
    use objc2_core_foundation::CGPoint;
    use objc2_foundation::{NSObject, NSSet, NSString, ns_string};
    use objc2_ui_kit::{
        UIApplication, UIColor, UIEvent, UIGestureRecognizer, UIGestureRecognizerState,
        UIResponder, UIScrollView, UIScrollViewContentInsetAdjustmentBehavior, UITouch, UIView,
        UIWindow, UIWindowScene,
    };
    use objc2_web_kit::{WKUserContentController, WKWebViewConfiguration, WKWebsiteDataStore};

    use super::views::{FrameMessages, cg, in_hole, set_mask, wrapper};
    use super::{FrameSpec, MaskShape, Placement};

    extern_class!(
        /// WebKit's web view, a `UIView` on iOS (objc2-web-kit declares it for macOS only).
        #[unsafe(super(UIView, UIResponder, NSObject))]
        #[thread_kind = MainThreadOnly]
        #[name = "WKWebView"]
        struct WebView;
    );

    struct HostIvars {
        /// The mask on the view now: where something else is drawn over it.
        mask: RefCell<Option<MaskShape>>,
        /// Not shown yet (its box has no opacity): touches go to what is behind.
        passes_presses: Cell<bool>,
    }

    define_class!(
        // SAFETY: UIView has no subclassing requirements beyond the main thread, and the class
        // does not implement `Drop`.
        #[unsafe(super(UIView, UIResponder, NSObject))]
        #[thread_kind = MainThreadOnly]
        #[name = "HazelFrameHost"]
        #[ivars = HostIvars]
        /// The part of a frame's box that shows: it clips the web view inside it.
        struct FrameHost;

        impl FrameHost {
            /// No view where the frame is not shown yet or something else is drawn over it: the
            /// touch goes to the view behind, which is Rune's.
            #[unsafe(method(hitTest:withEvent:))]
            fn hit_test(&self, point: CGPoint, event: Option<&UIEvent>) -> *mut UIView {
                let ivars = self.ivars();
                // `point` is in the host's own coordinates.
                if ivars.passes_presses.get()
                    || in_hole(ivars.mask.borrow().as_ref(), [point.x as f32, point.y as f32])
                {
                    return std::ptr::null_mut();
                }
                unsafe { msg_send![super(self), hitTest: point, withEvent: event] }
            }
        }
    );

    struct ForwarderIvars {
        /// Rune's view, which turns touches into its own (winit's `touchesBegan:` and the rest).
        target: Weak<UIView>,
        /// Fingers down on the page now.
        down: Cell<usize>,
    }

    define_class!(
        // SAFETY: UIGestureRecognizer may be subclassed for its touch methods; the class does
        // not implement `Drop`.
        #[unsafe(super(UIGestureRecognizer, NSObject))]
        #[thread_kind = MainThreadOnly]
        #[name = "HazelFrameTouchForwarder"]
        #[ivars = ForwarderIvars]
        /// Hands every touch on an inline page to Rune's view too, without taking it from the
        /// page: it never recognizes, so a tap still presses what is under it in the page, and
        /// a drag scrolls the list in Rune, as it would over any other part of a message.
        struct TouchForwarder;

        impl TouchForwarder {
            #[unsafe(method(touchesBegan:withEvent:))]
            fn touches_began(&self, touches: &NSSet<UITouch>, event: &UIEvent) {
                let _: () = unsafe { msg_send![super(self), touchesBegan: touches, withEvent: event] };
                self.ivars().down.set(self.ivars().down.get() + touches.count());
                if let Some(target) = self.ivars().target.load() {
                    target.touchesBegan_withEvent(touches, Some(event));
                }
            }

            #[unsafe(method(touchesMoved:withEvent:))]
            fn touches_moved(&self, touches: &NSSet<UITouch>, event: &UIEvent) {
                let _: () = unsafe { msg_send![super(self), touchesMoved: touches, withEvent: event] };
                if let Some(target) = self.ivars().target.load() {
                    target.touchesMoved_withEvent(touches, Some(event));
                }
            }

            #[unsafe(method(touchesEnded:withEvent:))]
            fn touches_ended(&self, touches: &NSSet<UITouch>, event: &UIEvent) {
                let _: () = unsafe { msg_send![super(self), touchesEnded: touches, withEvent: event] };
                if let Some(target) = self.ivars().target.load() {
                    target.touchesEnded_withEvent(touches, Some(event));
                }
                self.lifted(touches);
            }

            #[unsafe(method(touchesCancelled:withEvent:))]
            fn touches_cancelled(&self, touches: &NSSet<UITouch>, event: &UIEvent) {
                let _: () = unsafe { msg_send![super(self), touchesCancelled: touches, withEvent: event] };
                if let Some(target) = self.ivars().target.load() {
                    target.touchesCancelled_withEvent(touches, Some(event));
                }
                self.lifted(touches);
            }

            /// Nothing the page recognizes (a long press selecting text) ends it early: Rune would
            /// keep a finger that never lifts.
            #[unsafe(method(canBePreventedByGestureRecognizer:))]
            fn can_be_prevented(&self, _other: &UIGestureRecognizer) -> bool {
                false
            }

            /// It never takes a touch from the page's own gestures.
            #[unsafe(method(canPreventGestureRecognizer:))]
            fn can_prevent(&self, _other: &UIGestureRecognizer) -> bool {
                false
            }

            #[unsafe(method(reset))]
            fn reset(&self) {
                self.ivars().down.set(0);
                let _: () = unsafe { msg_send![super(self), reset] };
            }
        }
    );

    impl TouchForwarder {
        fn new(mtm: MainThreadMarker, target: &UIView) -> Retained<Self> {
            let this = Self::alloc(mtm).set_ivars(ForwarderIvars {
                target: Weak::new(target),
                down: Cell::new(0),
            });
            let this: Retained<Self> = unsafe {
                msg_send![super(this), initWithTarget: None::<&AnyObject>, action: None::<objc2::runtime::Sel>]
            };
            this.setCancelsTouchesInView(false);
            this.setDelaysTouchesBegan(false);
            this.setDelaysTouchesEnded(false);
            this
        }

        /// Once the last finger is up the gesture is over: failing ends it, so the next touch
        /// starts afresh, and the page's own gestures never wait on it.
        fn lifted(&self, touches: &NSSet<UITouch>) {
            let down = self.ivars().down.get().saturating_sub(touches.count());
            self.ivars().down.set(down);
            if down == 0 {
                self.setState(UIGestureRecognizerState::Failed);
            }
        }
    }

    pub(super) struct FrameView {
        host: Retained<FrameHost>,
        web: Retained<WebView>,
        forwarder: Retained<TouchForwarder>,
    }

    /// The app's window, and in it the view Rune draws in.
    fn window(mtm: MainThreadMarker) -> Option<(Retained<UIWindow>, Retained<UIView>)> {
        let app = UIApplication::sharedApplication(mtm);
        #[allow(deprecated)]
        let window = app.connectedScenes().iter().find_map(|scene| {
            let scene = scene.downcast::<UIWindowScene>().ok()?;
            scene.windows().firstObject()
        })?;
        let rune = window.rootViewController()?.view()?;
        Some((window, rune))
    }

    fn scroll_view(web: &WebView) -> Retained<UIScrollView> {
        unsafe { msg_send![web, scrollView] }
    }

    impl FrameView {
        /// A frame's views, hidden over Rune's until placed: the clipping host, and in it the web
        /// view with its bridge to the runtime, a store of its own and no background.
        pub(super) fn create(mtm: MainThreadMarker, frame: &FrameSpec) -> Option<Self> {
            let (window, rune) = window(mtm)?;
            let host: Retained<FrameHost> = {
                let this = FrameHost::alloc(mtm).set_ivars(HostIvars {
                    mask: RefCell::new(None),
                    passes_presses: Cell::new(true),
                });
                unsafe { msg_send![super(this), initWithFrame: cg([0.0; 4])] }
            };
            host.setClipsToBounds(true);

            let configuration = unsafe { WKWebViewConfiguration::new(mtm) };
            // Nothing a page's assets store (cookies, caches) outlives the app or is shared with
            // anything else that keeps web data.
            unsafe {
                configuration.setWebsiteDataStore(&WKWebsiteDataStore::nonPersistentDataStore(mtm));
                // A page's video plays in its box, as in a browser tab, not fullscreen.
                let _: () = msg_send![&*configuration, setAllowsInlineMediaPlayback: true];
                // A long press on an inline page is the message's menu: no text selection or
                // its callout from the page over it. A fullscreen page selects text as a tab does.
                let preferences: Retained<AnyObject> = msg_send![&*configuration, preferences];
                let selects = super::scrolls_itself(&frame.src);
                let _: () = msg_send![&*preferences, setTextInteractionEnabled: selects];
            }
            let messages = FrameMessages::new(mtm, &frame.path);
            unsafe {
                configuration
                    .userContentController()
                    .addScriptMessageHandler_name(
                        ProtocolObject::from_ref(&*messages),
                        ns_string!("hazel"),
                    );
            }
            let web: Retained<WebView> = unsafe {
                msg_send![WebView::alloc(mtm), initWithFrame: cg([0.0; 4]), configuration: &*configuration]
            };
            // The page sits on the channel's background, drawn by Rune under the view.
            let clear = UIColor::clearColor();
            web.setOpaque(false);
            web.setBackgroundColor(Some(&clear));
            let scroll = scroll_view(&web);
            scroll.setBackgroundColor(Some(&clear));
            // The page is laid out in its box alone: the window's safe area is not its business.
            scroll.setContentInsetAdjustmentBehavior(
                UIScrollViewContentInsetAdjustmentBehavior::Never,
            );
            unsafe {
                let _: () = msg_send![&*web, setUnderPageBackgroundColor: &*clear];
                // A long press is the message's menu, as on the rest of the message.
                let _: () = msg_send![&*web, setAllowsLinkPreview: false];
            }
            let forwarder = TouchForwarder::new(mtm, &rune);
            host.addGestureRecognizer(&forwarder);
            host.addSubview(&web);
            host.setHidden(true);
            window.addSubview(&host);
            Some(Self {
                host,
                web,
                forwarder,
            })
        }

        /// An inline page is as tall as its box and never scrolls: a drag over it is Rune's.
        /// A fullscreen one scrolls its own page and keeps its touches.
        pub(super) fn load(&self, src: &str) {
            let Some(html) = wrapper(src) else {
                return;
            };
            let scrolls_itself = super::scrolls_itself(src);
            let scroll = scroll_view(&self.web);
            scroll.setScrollEnabled(scrolls_itself);
            scroll.setBounces(scrolls_itself);
            self.forwarder.setEnabled(!scrolls_itself);
            unsafe {
                let _: Option<Retained<AnyObject>> =
                    msg_send![&*self.web, loadHTMLString: &*html, baseURL: None::<&AnyObject>];
            }
        }

        /// The host shows `visible`; the web view inside keeps the whole box, so the page does
        /// not reflow as it scrolls under a clip.
        pub(super) fn put(&self, placement: &Placement) {
            let [vx, vy, ..] = placement.visible;
            let host_frame = cg(placement.visible);
            if self.host.frame() != host_frame {
                self.host.setFrame(host_frame);
            }
            let [x, y, w, h] = placement.rect;
            let web_frame = cg([x - vx, y - vy, w, h]);
            if self.web.frame() != web_frame {
                self.web.setFrame(web_frame);
            }
            let shown = placement.opacity > 0.0;
            self.host.ivars().passes_presses.set(!shown);
            self.host.setAlpha(placement.opacity as f64);
            self.host.setHidden(false);

            // Rebuilt when the holes move and when the part that shows changes size.
            let mask = placement.mask();
            if *self.host.ivars().mask.borrow() == mask {
                return;
            }
            set_mask(&self.host.layer(), mask.as_ref());
            *self.host.ivars().mask.borrow_mut() = mask;
        }

        pub(super) fn hide(&self) {
            self.host.setHidden(true);
        }

        /// Takes the views out of the window; the bridge goes first, as the web view's content
        /// controller would otherwise keep it, and the frame's path, alive.
        pub(super) fn remove(&self) {
            unsafe {
                let configuration: Retained<WKWebViewConfiguration> =
                    msg_send![&*self.web, configuration];
                let controller: Retained<WKUserContentController> =
                    configuration.userContentController();
                controller.removeAllScriptMessageHandlers();
            }
            self.host.removeFromSuperview();
        }

        pub(super) fn evaluate(&self, script: &str) {
            let script = NSString::from_str(script);
            unsafe {
                let _: () = msg_send![
                    &*self.web,
                    evaluateJavaScript: &*script,
                    completionHandler: std::ptr::null::<AnyObject>()
                ];
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_frame_shows_where_its_ancestors_let_it() {
        let rect = [100.0, 50.0, 400.0, 900.0];
        let list = [0.0, 80.0, 800.0, 600.0];
        let placed = place(rect, 1.0, &[list], &[]).unwrap();
        assert_eq!(placed.rect, rect);
        assert_eq!(placed.visible, [100.0, 80.0, 400.0, 600.0]);
        assert!(placed.holes.is_empty());
        // Scrolled out of the list: nothing shows.
        assert_eq!(place([100.0, 700.0, 400.0, 300.0], 1.0, &[list], &[]), None);
        // Not shown yet (its page is loading): it keeps its place.
        assert_eq!(place(rect, 0.0, &[list], &[]).unwrap().opacity, 0.0);
    }

    #[test]
    fn a_menu_cuts_a_hole_and_a_dialog_hides_the_frame() {
        let rect = [100.0, 100.0, 400.0, 300.0];
        let menu = Cover {
            rect: [450.0, 80.0, 120.0, 60.0],
            modal: false,
        };
        let elsewhere = Cover {
            rect: [600.0, 600.0, 50.0, 50.0],
            modal: false,
        };
        let placed = place(rect, 1.0, &[], &[menu, elsewhere]).unwrap();
        assert_eq!(placed.holes, vec![[450.0, 100.0, 50.0, 40.0]]);
        let dialog = Cover {
            rect: [0.0, 0.0, 10.0, 10.0],
            modal: true,
        };
        assert_eq!(place(rect, 1.0, &[], &[dialog]), None);
    }

    #[test]
    fn a_frame_that_grows_under_a_cover_needs_a_new_mask() {
        let toolbar = Cover {
            rect: [400.0, 90.0, 80.0, 30.0],
            modal: false,
        };
        let list = [0.0, 100.0, 800.0, 600.0];
        let short = place([100.0, 100.0, 400.0, 300.0], 1.0, &[list], &[toolbar]).unwrap();
        let grown = place([100.0, 100.0, 400.0, 500.0], 1.0, &[list], &[toolbar]).unwrap();
        // The hole is where it was, from the view's top left; only the view's size changed.
        let short_mask = short.mask().unwrap();
        let grown_mask = grown.mask().unwrap();
        assert_eq!(short_mask.holes, vec![[300.0, 0.0, 80.0, 20.0]]);
        assert_eq!(grown_mask.holes, short_mask.holes);
        assert_eq!(grown_mask.size, [400.0, 500.0]);
        assert_ne!(grown_mask, short_mask);
        // Nothing over it: no mask at all.
        assert_eq!(
            place([100.0, 100.0, 400.0, 300.0], 1.0, &[list], &[])
                .unwrap()
                .mask(),
            None
        );
    }

    #[test]
    fn the_wrapper_frames_the_page_sandboxed_from_its_own_origin_only() {
        let src = "https://api.hazel.sh/html-renders/a/b/c?exp=1&sig=x\"y#hazel-theme=%7B%22appearance%22%3A%22light%22%7D&hazel-display=inline";
        let html = wrapper_html(src).unwrap();
        assert!(html.contains("frame-src https://api.hazel.sh\""));
        assert!(html.contains(r#"sandbox="allow-scripts" referrerpolicy="no-referrer""#));
        assert!(html.contains("exp=1&amp;sig=x&quot;y#hazel-theme"));
        assert!(html.contains("color-scheme:light"));
        assert!(html.contains(r#"name="viewport" content="width=device-width"#));
        assert!(!scrolls_itself(src));
        assert!(scrolls_itself(
            "https://api.hazel.sh/x#hazel-theme=%7B%7D&hazel-display=fullscreen"
        ));
        assert_eq!(
            origin_of("http://localhost:3003/html-renders/x"),
            Some("http://localhost:3003")
        );
        assert_eq!(wrapper_html("javascript:alert(1)"), None);
        assert_eq!(wrapper_html("https://a.test'; script-src *//x"), None);
    }

    #[test]
    fn a_sticky_box_covers_the_frames_of_its_layer_but_not_one_it_holds() {
        let frame = |path: &str, layer: Option<&str>| FrameSpec {
            path: path.into(),
            src: "https://api.hazel.sh/x".into(),
            clips: vec![],
            layer: layer.map(str::to_string),
        };
        let pinned = CoverSpec {
            path: "r/0".into(),
            modal: false,
            sticky_in: Some(None),
        };
        assert!(pinned.is_over(&frame("r/1", None)));
        // A frame inside the sticky box is part of what it paints.
        assert!(!pinned.is_over(&frame("r/0/1", None)));
        // A dialog's frame is above the page's sticky boxes.
        assert!(!pinned.is_over(&frame("r/2/0", Some("r/2"))));
    }

    #[test]
    fn what_the_wrapper_posts_goes_to_the_runtime_by_path() {
        assert_eq!(
            runtime_message("r/1", r#"{"k":"load"}"#),
            Some(serde_json::json!({ "t": "frame", "path": "r/1", "event": "load" }))
        );
        assert_eq!(
            runtime_message(
                "r/1",
                r#"{"k":"message","data":{"jsonrpc":"2.0"},"active":true}"#
            ),
            Some(serde_json::json!({
                "t": "frame", "path": "r/1", "event": "message",
                "data": { "jsonrpc": "2.0" }, "active": true,
            }))
        );
        assert_eq!(runtime_message("r/1", r#"{"k":"other"}"#), None);
        assert_eq!(runtime_message("r/1", "not json"), None);
    }
}
