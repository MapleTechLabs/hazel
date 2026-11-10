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
}

/// The frames of a tree, in document order.
pub fn collect(root: &Arc<Node>) -> Vec<FrameSpec> {
    let mut out = Vec::new();
    walk(root, "r", &mut Vec::new(), &mut out);
    out
}

/// Collects the frames under `node`, with the clipping ancestors met on the way down (`clips`).
fn walk(node: &Arc<Node>, path: &str, clips: &mut Vec<String>, out: &mut Vec<FrameSpec>) {
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
    if tag == "iframe" {
        if let Some(src) = attrs.get("src").filter(|src| !src.is_empty()) {
            out.push(FrameSpec {
                path: path.to_string(),
                src: src.clone(),
                clips: clips.clone(),
            });
        }
        return;
    }
    // A portal draws at the window's root: what clips the place it left does not clip it.
    let mut own_clips = Vec::new();
    let clips = if crate::is_portal(node) {
        &mut own_clips
    } else {
        clips
    };
    let clipping = st.scroll_y == Some(true) || st.clip == Some(true);
    if clipping {
        clips.push(path.to_string());
    }
    for (i, child) in children.iter().enumerate() {
        walk(child, &crate::child_path(path, i, child), clips, out);
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
}

/// What is drawn over a frame's box: the overlays among `portals`, and the sticky elements of
/// the tree, which stay put while a frame scrolls under them. A dialog covers as a whole.
/// Anything else covers where it paints: its outermost boxes with a background, since the
/// element that places a menu is often an empty layer as large as the window.
pub fn collect_covers(root: &Arc<Node>, portals: &[(String, Arc<Node>)]) -> Vec<CoverSpec> {
    let mut out = Vec::new();
    sticky(root, "r", &mut out);
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
            });
        } else {
            painted(node, path, &mut out);
        }
    }
    out
}

/// The sticky elements under `node`, as what they paint: a frame scrolls under them.
fn sticky(node: &Arc<Node>, path: &str, out: &mut Vec<CoverSpec>) {
    let Node::Elem { st, children, .. } = node.as_ref() else {
        return;
    };
    if st.display.as_deref() == Some("none") {
        return;
    }
    if st.sticky_top.is_some() {
        painted(node, path, out);
        return;
    }
    for (i, child) in children.iter().enumerate() {
        sticky(child, &crate::child_path(path, i, child), out);
    }
}

/// The outermost boxes under `node` that have a background: where an overlay is seen, and so
/// where it covers. What such a box holds is inside it and adds nothing.
fn painted(node: &Arc<Node>, path: &str, out: &mut Vec<CoverSpec>) {
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
        });
        return;
    }
    for (i, child) in children.iter().enumerate() {
        painted(child, &crate::child_path(path, i, child), out);
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
enum PageEvent {
    Load,
    Message {
        data: serde_json::Value,
        #[serde(default)]
        active: bool,
    },
}

/// The line for the runtime, for what the wrapper page of the frame at `path` posted.
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
fn scrolls_itself(src: &str) -> bool {
    src.contains("hazel-display=fullscreen")
}

/// The web view's own document: the page in a sandboxed frame, as the web app frames it
/// (`sandbox="allow-scripts"`, no referrer), and the script that stands between that frame and
/// the host. `None` for a `src` that is not an http(s) URL.
///
/// The frame's canvas stays transparent only while its colour scheme matches the page's, so the
/// wrapper follows the theme the app posts.
pub fn wrapper_html(src: &str) -> Option<String> {
    let origin = origin_of(src)?;
    let scheme = if is_light(src) { "light" } else { "dark" };
    Some(format!(
        r#"<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; frame-src {origin}"><style>html,body{{margin:0;height:100%;overflow:hidden;background:transparent}}iframe{{display:block;width:100%;height:100%;border:0;background:transparent;color-scheme:{scheme}}}</style></head><body><iframe id="f" sandbox="allow-scripts" referrerpolicy="no-referrer" src="{src}"></iframe><script>(function(){{var f=document.getElementById("f"),h=window.webkit.messageHandlers.hazel;function s(m){{h.postMessage(JSON.stringify(m));}}f.addEventListener("load",function(){{s({{k:"load"}});}});window.addEventListener("message",function(e){{if(e.source!==f.contentWindow)return;var u=navigator.userActivation;try{{s({{k:"message",data:e.data,active:document.activeElement===f&&!!(u&&u.isActive)}});}}catch(x){{}}}});window.__hazelPost=function(m){{var t=m&&m.params&&m.params.theme;if(t==="light"||t==="dark")f.style.colorScheme=t;f.contentWindow.postMessage(m,"*");}};}})();</script></body></html>"#,
        origin = origin,
        scheme = scheme,
        src = escape_attribute(src),
    ))
}

/// Puts every frame's web view where its box was drawn in the frame just presented.
pub fn sync(runtime: &rune::Runtime<crate::State>) {
    let state = &runtime.state;
    if state.frames.is_empty() && !native::any() {
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
                // The dialog a frame is in is not over it.
                .filter(|cover| {
                    !frame
                        .path
                        .strip_prefix(cover.path.as_str())
                        .is_some_and(|rest| rest.starts_with('/'))
                })
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
    native::apply(&placed);
}

/// `contentWindow.postMessage(data)` on the frame at `path`.
pub fn post(path: &str, data: &serde_json::Value) {
    native::post(path, data);
}

/// No web view on this platform: frames keep their boxes and show nothing.
#[cfg(not(target_os = "macos"))]
mod native {
    use super::{FrameSpec, Placement};

    pub fn any() -> bool {
        false
    }
    pub fn apply(_: &[(&FrameSpec, Option<Placement>)]) {}
    pub fn post(_: &str, _: &serde_json::Value) {}
}

/// The frames' web views in the app's window: a `WKWebView` each, inside a host view that clips it.
#[cfg(target_os = "macos")]
mod native {
    use std::cell::{Cell, RefCell};
    use std::collections::HashMap;

    use objc2::rc::Retained;
    use objc2::runtime::ProtocolObject;
    use objc2::{DefinedClass, MainThreadMarker, MainThreadOnly, define_class, msg_send};
    use objc2_app_kit::{NSApplication, NSColor, NSEvent, NSView};
    use objc2_core_foundation::{CGPoint, CGRect, CGSize};
    use objc2_core_graphics::CGMutablePath;
    use objc2_foundation::{NSNumber, NSObject, NSObjectProtocol, NSString, ns_string};
    use objc2_quartz_core::{CAShapeLayer, kCAFillRuleEvenOdd};
    use objc2_web_kit::{
        WKScriptMessage, WKScriptMessageHandler, WKUserContentController, WKWebView,
        WKWebViewConfiguration, WKWebsiteDataStore,
    };

    use super::{FrameSpec, MaskShape, Placement, Rect};

    /// A Rune rect (`[x, y, w, h]`, from the top left) as AppKit's.
    fn cg(rect: Rect) -> CGRect {
        CGRect::new(
            CGPoint::new(rect[0] as f64, rect[1] as f64),
            CGSize::new(rect[2] as f64, rect[3] as f64),
        )
    }

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
                let (x, y) = (own.x as f32, own.y as f32);
                let in_hole = ivars.mask.borrow().as_ref().is_some_and(|mask| {
                    mask.holes
                        .iter()
                        .any(|[hx, hy, hw, hh]| x >= *hx && x < hx + hw && y >= *hy && y < hy + hh)
                });
                if in_hole {
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

    struct MessagesIvars {
        path: String,
    }

    define_class!(
        // SAFETY: NSObject has no subclassing requirements; the class does not implement `Drop`.
        #[unsafe(super(NSObject))]
        #[thread_kind = MainThreadOnly]
        #[name = "HazelFrameMessages"]
        #[ivars = MessagesIvars]
        /// What a frame's wrapper page posts to the host.
        struct FrameMessages;

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
                    crate::write_line(line);
                }
            }
        }
    );

    struct FrameView {
        host: Retained<FrameHost>,
        web: Retained<FrameWebView>,
        src: String,
    }

    thread_local! {
        static VIEWS: RefCell<HashMap<String, FrameView>> = RefCell::new(HashMap::new());
    }

    /// Whether any web view exists: with none and no frame in the tree, a drawn frame has nothing to place.
    pub fn any() -> bool {
        VIEWS.with_borrow(|views| !views.is_empty())
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

    /// Loads the wrapper page for `src` into the view; a `src` the wrapper refuses loads nothing.
    fn load(web: &FrameWebView, src: &str) {
        let Some(html) = super::wrapper_html(src) else {
            eprintln!("[host] a frame's src is not an http(s) URL");
            return;
        };
        web.ivars().scrolls_itself.set(super::scrolls_itself(src));
        unsafe { web.loadHTMLString_baseURL(&NSString::from_str(&html), None) };
    }

    /// A frame's views, hidden in `parent` until placed: the clipping host, and in it the web view
    /// with its bridge to the runtime, a store of its own and no background.
    fn create(mtm: MainThreadMarker, parent: &NSView, frame: &FrameSpec) -> FrameView {
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
        let messages: Retained<FrameMessages> = {
            let this = FrameMessages::alloc(mtm).set_ivars(MessagesIvars {
                path: frame.path.clone(),
            });
            unsafe { msg_send![super(this), init] }
        };
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
        load(&web, &frame.src);
        FrameView {
            host,
            web,
            src: frame.src.clone(),
        }
    }

    /// The host shows `visible`; the web view inside keeps the whole box, so the page does not
    /// reflow as it scrolls under a clip.
    fn put(view: &FrameView, placement: &Placement) {
        let [vx, vy, ..] = placement.visible;
        let host_frame = cg(placement.visible);
        if view.host.frame() != host_frame {
            view.host.setFrame(host_frame);
        }
        let [x, y, w, h] = placement.rect;
        let web_frame = cg([x - vx, y - vy, w, h]);
        if view.web.frame() != web_frame {
            view.web.setFrame(web_frame);
        }
        let shown = placement.opacity > 0.0;
        view.host.ivars().passes_presses.set(!shown);
        view.host.setAlphaValue(placement.opacity as f64);
        view.host.setHidden(false);

        // Rebuilt when the holes move and when the part that shows changes size.
        let mask = placement.mask();
        if *view.host.ivars().mask.borrow() == mask {
            return;
        }
        let Some(layer) = view.host.layer() else {
            return;
        };
        match &mask {
            None => unsafe { layer.setMask(None) },
            Some(shape) => {
                // Everything but the holes: with the even-odd rule a rect inside the outer one is cut out.
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
        }
        *view.host.ivars().mask.borrow_mut() = mask;
    }

    /// Takes a frame's views out of the window; the bridge goes first, as the web view's content
    /// controller would otherwise keep it, and the frame's path, alive.
    fn remove(view: FrameView) {
        unsafe {
            view.web
                .configuration()
                .userContentController()
                .removeAllScriptMessageHandlers();
        }
        view.host.removeFromSuperview();
    }

    /// Brings the web views in line with the frames of the tree just drawn: removes the ones whose
    /// frame is gone, creates the ones that are new, reloads a changed `src`, and places each.
    pub fn apply(placed: &[(&FrameSpec, Option<Placement>)]) {
        let Some(mtm) = MainThreadMarker::new() else {
            return;
        };
        VIEWS.with_borrow_mut(|views| {
            let gone: Vec<String> = views
                .keys()
                .filter(|path| !placed.iter().any(|(frame, _)| frame.path == **path))
                .cloned()
                .collect();
            for path in gone {
                if let Some(view) = views.remove(&path) {
                    remove(view);
                }
            }
            for (frame, placement) in placed {
                if !views.contains_key(&frame.path) {
                    // A frame nothing shows of yet still loads, as a browser's does; one under
                    // a dialog waits until it is uncovered.
                    let Some(parent) = placement.as_ref().and_then(|_| window_view(mtm)) else {
                        continue;
                    };
                    views.insert(frame.path.clone(), create(mtm, &parent, frame));
                }
                let Some(view) = views.get_mut(&frame.path) else {
                    continue;
                };
                if view.src != frame.src {
                    view.src = frame.src.clone();
                    load(&view.web, &frame.src);
                }
                match placement {
                    Some(placement) => put(view, placement),
                    None => view.host.setHidden(true),
                }
            }
        });
    }

    /// Hands `data` to the wrapper page of the frame at `path`, which posts it to the framed page.
    pub fn post(path: &str, data: &serde_json::Value) {
        VIEWS.with_borrow(|views| {
            let Some(view) = views.get(path) else {
                return;
            };
            let script = format!("window.__hazelPost&&window.__hazelPost({data})");
            unsafe {
                view.web
                    .evaluateJavaScript_completionHandler(&NSString::from_str(&script), None)
            };
        });
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
