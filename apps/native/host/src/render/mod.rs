//! The runtime's tree drawn with Rune: each wire node becomes an element laid out as the browser
//! would, and presses, keys, edits and layout go back to the runtime as the DOM events its
//! handlers expect.
mod events;
mod fields;
mod flow;
mod handlers;
mod media;
mod state;
mod table_grid;

use std::collections::HashMap;
use std::sync::Arc;

use rune::{Align, Color, Cx, El, Side, SurfaceFit, col, el, row};

use crate::html::{is_checkable, is_text_field, lays_out_inline};
use crate::images;
use crate::layout::{Inherit, apply_box, apply_flex, center_vertically, color, text_run};
use crate::wire::{self, Node, Style};

pub use events::{PRESS_EVENTS, window_key};
pub use handlers::note_scroll;
#[cfg(test)]
pub(crate) use handlers::scroll_seqs;
pub(crate) use state::is_portal;
pub use state::{Env, State, child_path, last_env};

use events::{POINTER_ONLY_EVENTS, send_dismiss, send_paste};
use fields::{build_editable, build_input};
use flow::{
    Parent, add_children, bounds_scroller, drop_grow, grid_fill, is_inline, join_text,
    justify_by_text_align, size_to_content,
};
use handlers::{behaviour, observe, presses};
use media::{build_img, build_svg, picture_size};
use state::{note_appearance, report_env, theme_override};
use table_grid::{build_grid, build_table, grid_height_estimate, grid_scroll_bound};

/// The web app sets `-webkit-font-smoothing: antialiased` on `html`: text without CoreText's
/// smoothing dilation, lighter than macOS's default.
pub const TEXT_SMOOTHING: rune::FontSmoothing = rune::FontSmoothing::Off;

struct Ctx<'a> {
    s: &'a State,
    form: Option<u32>,
    /// The `keydown` handlers of the elements around this one, innermost first: a text field
    /// keeps its keys from Rune's `on_key`, so it bubbles them to these as the DOM does.
    keys: &'a [u32],
    /// Building an inline formatting context's own children, where a space between runs counts.
    inline: bool,
    /// The portal being built at the window's root; any other portal is skipped where it sits.
    portal: Option<&'a str>,
    /// Under `pointer-events: none`: no presses or hover, though keys and focus still work.
    no_pointer: bool,
}

fn build(node: &Arc<Node>, path: &str, inh: Inherit, ctx: &Ctx) -> Option<El> {
    match node.as_ref() {
        Node::Text(s) => {
            // Whitespace between blocks collapses away, unless `white-space: pre` keeps it; inside
            // a line it collapses to one space, which separates two mention chips.
            if s.is_empty() || (!inh.pre && !ctx.inline && s.trim().is_empty()) {
                return None;
            }
            if !inh.pre && s.trim().is_empty() {
                return Some(text_run(" ", &inh));
            }
            Some(text_run(s, &inh))
        }
        Node::Svg { st, .. } if st.display.as_deref() == Some("none") => None,
        Node::Svg {
            view,
            body,
            st,
            par,
            ..
        } => Some(build_svg(*view, body, st, par.as_deref(), inh, ctx)),
        Node::Elem {
            hash,
            tag,
            st,
            attrs,
            on,
            children,
            observed,
            ov,
            ..
        } => {
            if st.display.as_deref() == Some("none") {
                return None;
            }
            // A portal draws at the window's root (`view`), not where the tree puts it.
            if is_portal(node) && ctx.portal != Some(path) {
                return None;
            }
            // `pointer-events` inherits: `none` here or above (unless `auto` again) takes no pointer.
            let no_pointer = match st.pointer_events.as_deref() {
                Some("none") => true,
                Some("auto") => false,
                _ => ctx.no_pointer,
            };
            let unpointed: HashMap<String, u32>;
            let on = if no_pointer {
                unpointed = on
                    .iter()
                    .filter(|(k, _)| !POINTER_ONLY_EVENTS.contains(&k.as_str()))
                    .map(|(k, v)| (k.clone(), *v))
                    .collect();
                &unpointed
            } else {
                on
            };
            let pointed;
            let ctx = if no_pointer == ctx.no_pointer {
                ctx
            } else {
                pointed = Ctx { no_pointer, ..*ctx };
                &pointed
            };
            let inh = inh.from(st);
            if is_text_field(tag, attrs) {
                return Some(build_input(path, tag, st, attrs, on, inh, ctx));
            }
            if tag == "img" {
                return Some(center_vertically(build_img(path, st, attrs, on, ctx), st));
            }
            if tag == "table" {
                return Some(build_table(path, st, children, inh, ctx));
            }
            if attrs.contains_key("data-editable") {
                return Some(build_editable(path, st, attrs, children, inh, ctx));
            }
            // A native view draws this element: Rune keeps its box and paints none of it.
            if attrs.get(crate::islands::ATTR).is_some_and(|name| {
                crate::islands::draws(name) == Some(crate::islands::Draws::Native)
            }) {
                return build(&crate::islands::ghost(node), path, inh, ctx);
            }
            let form = if tag == "form" {
                on.get("submit").copied().or(ctx.form)
            } else {
                ctx.form
            };
            let with_own_key: Vec<u32>;
            let keys = match on.get("keydown") {
                Some(&id) => {
                    with_own_key = std::iter::once(id)
                        .chain(ctx.keys.iter().copied())
                        .collect();
                    &with_own_key[..]
                }
                None => ctx.keys,
            };
            // The element itself or one below it: `r/1` is no ancestor of `r/10/field`.
            let has_fields = ctx.s.fields.keys().any(|k| {
                k.strip_prefix(path)
                    .is_some_and(|rest| rest.is_empty() || rest.starts_with('/'))
            });
            // An anchored panel takes its content's height: `flex-1` (a 0% basis) inside a box of
            // indefinite height is content-sized in CSS, where Rune's `grow` would collapse it. So
            // does a column in an overlay (a dialog's panel) that nothing gives a height.
            let anchored = ov.as_ref().is_some_and(|o| o.anchor.is_some());
            let unsized_column = ctx.portal.is_some()
                && st.display.as_deref() == Some("flex")
                && st.dir.as_deref() == Some("col")
                && st.grow.is_none()
                && st.absolute.is_none();
            let content_sized: Vec<Arc<Node>>;
            let children: &[Arc<Node>] = if (anchored || unsized_column) && st.h.is_none() {
                content_sized = children.iter().map(|c| drop_grow(c, false)).collect();
                &content_sized
            } else {
                children
            };
            let make = || {
                let e = build_elem(
                    path,
                    tag,
                    st,
                    attrs,
                    on,
                    children,
                    inh,
                    &Ctx {
                        s: ctx.s,
                        form,
                        keys,
                        inline: false,
                        portal: ctx.portal,
                        no_pointer: ctx.no_pointer,
                    },
                );
                if *observed { observe(e, path, st) } else { e }
            };
            // Unchanged subtrees (same content hash, same inherited text, no live fields) reuse their El.
            let el = if has_fields {
                make()
            } else {
                rune::memo(
                    path.to_string(),
                    // `pointer-events: none` comes from an ancestor: the same subtree under one
                    // that toggles it must gain or lose its presses. A picture landing for this
                    // element or one inside it (`poll`) moves its epoch.
                    (
                        hash,
                        inh.key(),
                        form,
                        keys.to_vec(),
                        ctx.no_pointer,
                        ctx.s.images.epoch(path),
                    ),
                    make,
                )
            };
            Some(overlay(center_vertically(el, st), ov))
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn build_elem(
    path: &str,
    tag: &str,
    st: &Style,
    attrs: &HashMap<String, String>,
    on: &HashMap<String, u32>,
    children: &[Arc<Node>],
    inh: Inherit,
    ctx: &Ctx,
) -> El {
    let filled = grid_fill(st, children);
    let children = filled.as_deref().unwrap_or(children);
    // A scroll viewport's content sizes to itself (CSS `flex-1 min-h-full` there grows with the
    // content); Rune's `grow` would pin it to the viewport and leave nothing to scroll.
    let content_sized: Vec<Arc<Node>>;
    let children: &[Arc<Node>] =
        if st.scroll_y == Some(true) && !children.iter().any(bounds_scroller) {
            content_sized = children.iter().map(size_to_content).collect();
            &content_sized
        } else {
            children
        };
    let joined = join_text(children);
    let kids: Vec<(usize, &Arc<Node>)> = match &joined {
        Some(joined) => joined.iter().map(|(i, child)| (*i, child)).collect(),
        None => children.iter().enumerate().collect(),
    };
    // CSS bounds a filling inner scroller (or a growing box that may shrink to nothing) by its
    // scrolling parent; Rune's scroll content is unbounded, so the outer one becomes a clipped
    // flex column and only the inner one scrolls.
    let bounded;
    let st = if st.scroll_y == Some(true) && children.iter().any(bounds_scroller) {
        bounded = Style {
            scroll_y: None,
            clip: Some(true),
            ..st.clone()
        };
        &bounded
    } else {
        st
    };
    // `shrink-0` keeps an inline box at its size; Rune boxes only shrink when told to.
    let may_shrink = st.shrink.is_none_or(|s| s.0 > 0.0);
    // An inline formatting context's line: its runs wrap, placed along it by `text-align`.
    let inline_row = || {
        let r = justify_by_text_align(row().items_center().flex_wrap(), inh.align);
        if may_shrink { r.shrink() } else { r }
    };
    let items = st.items.as_deref();
    let inline_ctx = Ctx {
        inline: true,
        ..*ctx
    };
    // A grid with rows only has one implicit column.
    let one_column = [String::from("auto")];
    let grid_cols = st
        .grid_cols
        .as_deref()
        .or(st.grid_rows.as_ref().map(|_| &one_column[..]));
    let mut e = match (st.display.as_deref(), grid_cols) {
        // `overflow-y: auto` on a grid (the command palette's list). A Rune viewport scrolls only
        // in a bounded height, so a grid taller than its `max-h` becomes a viewport exactly that
        // tall; a shorter one stays a plain grid at its own height.
        (Some("grid"), Some(cols))
            if st.scroll_y == Some(true)
                && let Some(max_h) = grid_scroll_bound(st)
                && grid_height_estimate(&kids) > max_h =>
        {
            col()
                .h(max_h)
                .scroll(rune::ScrollSpec {
                    stick_bottom: false,
                })
                .child(build_grid(&kids, cols, path, inh, ctx, st).key(format!("{path}/grid")))
        }
        (Some("grid"), Some(cols)) => build_grid(&kids, cols, path, inh, ctx, st),
        (Some("flex"), _) => {
            let is_row = st.dir.as_deref() != Some("col");
            let base = if is_row { row() } else { col() };
            let parent = Parent {
                is_row,
                items,
                block: false,
            };
            add_children(
                crate::fx::under(apply_flex(base, st), attrs, st, path),
                &kids,
                path,
                inh,
                ctx,
                parent,
            )
        }
        (Some("inline") | None, _) if lays_out_inline(tag) => {
            // Inline boxes may shrink below their text, so the text inside can wrap.
            let parent = Parent {
                is_row: true,
                items: Some("center"),
                block: false,
            };
            add_children(
                crate::fx::under(apply_flex(inline_row(), st), attrs, st, path),
                &kids,
                path,
                inh,
                &inline_ctx,
                parent,
            )
        }
        // A block holding only inline content (text, spans, links): an inline formatting context,
        // approximated as a wrapping row so a mention chip stays in its sentence.
        (Some("block") | None, _) if kids.len() > 1 && kids.iter().all(|(_, c)| is_inline(c)) => {
            let parent = Parent {
                is_row: true,
                items: Some("center"),
                block: false,
            };
            add_children(
                crate::fx::under(apply_flex(inline_row(), st), attrs, st, path),
                &kids,
                path,
                inh,
                &inline_ctx,
                parent,
            )
        }
        _ => {
            // A block's children stack and stretch across it, as block boxes do.
            let parent = Parent {
                is_row: false,
                items,
                block: true,
            };
            add_children(
                crate::fx::under(apply_flex(col(), st), attrs, st, path),
                &kids,
                path,
                inh,
                ctx,
                parent,
            )
        }
    };
    if let Some(wire::BgImage { url: Some(url), .. }) = &st.bg_image
        && let Some(image) = ctx.s.images.get(url, picture_size(st), path)
    {
        // `background-size: cover`, the common case for avatars and banners.
        e = e.pixels_fit(image.pixels(), SurfaceFit::Fill)
    }
    e = crate::fx::glass_fill(apply_box(e.key(path), st), attrs, st);
    // A checkbox or radio is a 13px box unless styled, as a browser draws one; Tab skips a 0x0 one.
    if is_checkable(tag, attrs) {
        if st.w.is_none() {
            e = e.w(13.0);
        }
        if st.h.is_none() {
            e = e.h(13.0);
        }
    }
    if let Some(label) = attrs.get("aria-label") {
        e = e.label(label.clone());
    }
    e = presses(e, path, tag, attrs, on, ctx);
    // `ctx.keys` starts with this element's own keydown when it has one.
    let outer = if on.contains_key("keydown") {
        &ctx.keys[1..]
    } else {
        ctx.keys
    };
    behaviour(e, path, tag, attrs, on, st, outer)
}

/// A DOM element appears and vanishes at once; one fades only when its CSS says so (`Style`'s
/// `transition` and `animation`), where Rune would fade every element in and out.
pub fn dom_motion() {
    rune::set_default_transition(rune::Transition::none());
}

pub fn view(s: &State, cx: &mut Cx<State>) -> El {
    let dark = theme_override().unwrap_or_else(|| cx.system_dark());
    note_appearance(dark);
    let fallback = if dark {
        Color::WHITE
    } else {
        rune::color::hex("#09090b").unwrap()
    };
    let base = color(&s.page.color).unwrap_or(fallback);
    let inh = Inherit {
        color: base,
        ..Inherit::default()
    };
    let ctx = Ctx {
        s,
        form: None,
        keys: &[],
        inline: false,
        portal: None,
        no_pointer: false,
    };
    let body = s.root.as_ref().and_then(|root| build(root, "r", inh, &ctx));
    // The window's edges the system draws over (iOS's status bar and home indicator): the page
    // runs under them, edge to edge, as a web page with `viewport-fit=cover` does, and reads
    // them as `env(safe-area-inset-*)` to keep its content clear. The on-screen keyboard is
    // different: the page's viewport ends above it, as a browser's does, and the home
    // indicator's inset is then the keyboard's to cover.
    let [top, right, bottom, left] = cx.safe_area();
    let keyboard = s.keyboard;
    let inset = [top, right, if keyboard > 0.0 { 0.0 } else { bottom }, left];
    let mut page = col()
        .w_full()
        .h_full()
        .on_layout(move |_: &mut State, rect| report_env(rect, inset));
    let bg = color(&s.page.bg);
    if let Some(bg) = bg {
        page = page.fill(bg)
    }
    // The document scrolls when it is taller than the window, as a browser's viewport does.
    let document = col()
        .key("document")
        .w_full()
        .h_full()
        .scroll(rune::ScrollSpec {
            stick_bottom: false,
        });
    // Fixed elements and portals draw at the window's root. Fixed ones (not dialogs or menus,
    // which stay on top) go before the document,
    // so Tab and assistive technology meet them in document order; every layer is raised, so
    // they paint above the document in tree order (fixed, then menus and dialogs), as in CSS.
    // A fixed element inside a dialog or another layer stays with it, above the document.
    let fixed = |path: &String, node: &Arc<Node>| {
        matches!(node.as_ref(), Node::Elem { st, ov, .. } if st.fixed == Some(true) && ov.is_none())
            && !s
                .portals
                .iter()
                .any(|(p, _)| path.starts_with(&format!("{p}/")))
    };
    let layer = |path: &String, node: &Arc<Node>| {
        let ctx = Ctx {
            portal: Some(path),
            ..ctx
        };
        build(node, path, inh, &ctx).map(|built| {
            // Keyed, so a layer added in front leaves the ids (focus, scroll) of the rest alone.
            el().key(format!("layer:{path}"))
                .pin(Some(0.0), Some(0.0), Some(0.0), Some(0.0))
                .raise()
                .child(built)
        })
    };
    for (path, node) in s.portals.iter().filter(|(p, n)| fixed(p, n)) {
        if let Some(l) = layer(path, node) {
            page = page.child(l);
        }
    }
    page = page.child(document.child(body.unwrap_or_else(el)));
    // Portals inherit from the page, as an element moved into `<body>` does.
    for (path, node) in s.portals.iter().filter(|(p, n)| !fixed(p, n)) {
        if let Some(l) = layer(path, node) {
            page = page.child(l);
        }
    }
    // Always wrapped, the keyboard down or not: the tree keeps its shape, so the ids of the
    // elements under it (the focused composer's among them) stay put as the keyboard moves.
    // Wrapping only while the keyboard is up renamed every id, which dropped the composer's
    // focus, which lowered the keyboard, which renamed them back: a loop.
    // A paste with no field focused goes to the window's root, which hands it to the composer.
    let mut window = col()
        .w_full()
        .h_full()
        .pb(keyboard.max(0.0))
        .on_paste_content(|_: &mut State, content, _| send_paste(content));
    if let Some(bg) = bg {
        window = window.fill(bg)
    }
    window.child(page)
}

/// Places an overlay next to its trigger and makes it modal, as the runtime's `ov` asks.
fn overlay(mut e: El, ov: &Option<Box<wire::Overlay>>) -> El {
    let Some(ov) = ov else {
        return e;
    };
    if let Some(root) = ov.modal.clone() {
        e = e.modal(true, move |_: &mut State| send_dismiss(&root));
        // The browser hands focus back to the trigger (FocusScope `restoreFocus`), even after
        // a pointer press that never focused it.
        if let Some(a) = &ov.anchor {
            e = e.focus_return(a.to.clone());
        }
    }
    let Some(a) = &ov.anchor else {
        return e;
    };
    let side = match a.side.as_str() {
        "top" => Side::Top,
        "left" => Side::Left,
        "right" => Side::Right,
        _ => Side::Bottom,
    };
    let align = match a.align.as_str() {
        "start" => Align::Start,
        "end" => Align::End,
        _ => Align::Center,
    };
    let cross = a.cross.as_ref().map_or(0.0, |c| c.0);
    if cross == 0.0 {
        return e.anchored_fit(a.to.clone(), side, align, a.gap.0);
    }
    // Floating UI's `crossOffset` (a context menu at the pointer) slides the anchored box along
    // its trigger; a wrapper takes it, so the panel's own motion keeps its offset.
    let (x, y) = match side {
        Side::Top | Side::Bottom => (cross, 0.0),
        _ => (0.0, cross),
    };
    el().anchored_fit(a.to.clone(), side, align, a.gap.0)
        .offset(x, y)
        .child(e)
}

/// A picture landed (a download, a mask composite, a decode a box's size waited on): rebuild
/// the memoised subtrees that drew its empty box, and the ones around them, reusing the rest.
pub fn poll(s: &mut State, _: f64, tx: &mut rune::Tx) -> bool {
    // The shell-wide flag is for a shell that rebuilds everything; this one knows what waited.
    images::take_arrived();
    let landed = s.images.landed();
    if landed.is_empty() {
        return false;
    }
    if s.images.mark_stale(&landed) {
        tx.invalidate_memos_by_prefix("r");
    }
    true
}
