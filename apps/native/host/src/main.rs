//! Hazel's native window: draws the tree Hazel's Foldkit app renders in a Bun child process and
//! sends presses, edits and the window's size and theme back to it.
mod capture;
mod images;
mod layout;
mod svg_text;
#[cfg(test)]
mod tests;
mod wire;

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

use rune::edit::TextEdit;
use rune::text::Icon;
use rune::{App, AppSpec, Color, Cursor, Cx, El, SurfaceFit, col, el, icon, row, text_input};
use serde_json::json;

use layout::{
    Inherit, apply_box, apply_flex, auto_margins, center_vertically, color, focus_styles,
    focusable, text_run, track,
};
use wire::{Node, RuntimeMsg, Style, Subtrees, TreeMsg};

/// A text field's editor state, owned here because Rune's editor lives in app state.
struct Field {
    edit: TextEdit,
    /// Seq of the last edit sent; the app's `value` wins once the runtime has seen it.
    last_sent: u64,
}

#[derive(Default)]
pub(crate) struct State {
    root: Option<Arc<Node>>,
    subtrees: Subtrees,
    fields: HashMap<String, Field>,
    /// Last window size and theme reported to the runtime.
    reported: Option<(u32, u32, bool)>,
    dark: bool,
    /// The document's own background and text colour (`body` in the app's stylesheet).
    page: wire::Page,
    images: images::Images,
}

static OUT: OnceLock<Mutex<Box<dyn Write + Send>>> = OnceLock::new();
static SEQ: AtomicU64 = AtomicU64::new(0);
/// The generation of the tree on screen: an event runs the handler of the tree it was pressed on.
static GEN: AtomicU64 = AtomicU64::new(0);
static ICONS: Mutex<Option<HashMap<String, &'static Icon>>> = Mutex::new(None);

fn write_line(message: serde_json::Value) {
    if let Some(out) = OUT.get() {
        let mut out = out.lock().unwrap();
        let _ = writeln!(out, "{message}");
        let _ = out.flush();
    }
}

/// An edit or key in a native field drawn over a DOM-backed Mount (the composer's editor).
fn send_editable(path: &str, value: Option<&str>, key: Option<&str>) -> u64 {
    let seq = SEQ.fetch_add(1, Ordering::SeqCst) + 1;
    write_line(
        json!({ "t": "event", "seq": seq, "gen": GEN.load(Ordering::SeqCst), "id": 0, "type": "editable", "path": path, "value": value, "key": key }),
    );
    seq
}

/// The DOM `key` of the keys a field's own keydown handler (a combo box, a picker) acts on.
fn dom_key(key: &rune::edit::Key) -> Option<&'static str> {
    use rune::edit::Key;
    Some(match key {
        Key::Enter => "Enter",
        Key::Up => "ArrowUp",
        Key::Down => "ArrowDown",
        Key::Escape => "Escape",
        Key::Tab => "Tab",
        Key::Home => "Home",
        Key::End => "End",
        Key::PageUp => "PageUp",
        Key::PageDown => "PageDown",
        _ => return None,
    })
}

fn send_key(id: u32, key: &str, mods: rune::edit::Mods) -> u64 {
    let seq = SEQ.fetch_add(1, Ordering::SeqCst) + 1;
    write_line(json!({
        "t": "event", "seq": seq, "gen": GEN.load(Ordering::SeqCst), "id": id, "type": "keydown", "key": key,
        "shift": mods.shift, "meta": mods.cmd, "ctrl": mods.ctrl, "alt": mods.alt,
    }));
    seq
}

/// What a browser fires for one press, in order.
const PRESS_EVENTS: [&str; 3] = ["pointerdown", "pointerup", "click"];

/// A press as the browser reports it, for the handlers the element has. Rune reports a press
/// when it is released, so all of them go then (a menu opens on release, not on press).
fn press_handlers(e: El, on: &HashMap<String, u32>) -> El {
    let events: Vec<(&'static str, u32)> = PRESS_EVENTS
        .iter()
        .filter_map(|kind| on.get(*kind).map(|&id| (*kind, id)))
        .collect();
    if events.is_empty() {
        return e;
    }
    e.cursor(Cursor::Pointer).on_press(move |_: &mut State| {
        for (kind, id) in &events {
            send(*id, kind, None);
        }
    })
}

/// `keydown` while the element or one inside it has focus (Tab stays focus navigation), and
/// `mouseenter`/`mouseleave` as the pointer crosses it.
fn key_and_hover_handlers(mut e: El, on: &HashMap<String, u32>) -> El {
    if let Some(&id) = on.get("keydown") {
        e = e.on_key(move |_: &mut State, ev: &rune::edit::KeyEvent, _| {
            let name = match &ev.key {
                rune::edit::Key::Text(t) if t == " " => " ",
                key => match dom_key(key) {
                    Some("Tab") | None => return false,
                    Some(name) => name,
                },
            };
            send_key(id, name, ev.mods);
            true
        });
    }
    let (enter, leave) = (on.get("mouseenter").copied(), on.get("mouseleave").copied());
    if enter.is_some() || leave.is_some() {
        e = e.on_hover_change(move |_: &mut State, inside, _| {
            let event = if inside {
                enter.map(|id| (id, "mouseenter"))
            } else {
                leave.map(|id| (id, "mouseleave"))
            };
            if let Some((id, kind)) = event {
                send(id, kind, None);
            }
        });
    }
    e
}

fn send(id: u32, kind: &str, value: Option<&str>) -> u64 {
    let seq = SEQ.fetch_add(1, Ordering::SeqCst) + 1;
    write_line(
        json!({ "t": "event", "seq": seq, "gen": GEN.load(Ordering::SeqCst), "id": id, "type": kind, "value": value }),
    );
    seq
}

/// Rune icons are `&'static`; one per distinct body (an app has a bounded icon set).
fn intern_icon(view: f32, body: &str) -> &'static Icon {
    let mut icons = ICONS.lock().unwrap();
    let map = icons.get_or_insert_with(HashMap::new);
    let key = format!("{view}|{body}");
    if let Some(i) = map.get(&key) {
        return i;
    }
    let leaked: &'static Icon = Box::leak(Box::new(Icon {
        name: "hazel",
        view,
        body: Box::leak(body.to_string().into_boxed_str()),
    }));
    map.insert(key, leaked);
    leaked
}

fn child_path(parent: &str, index: usize, node: &Node) -> String {
    match node {
        Node::Elem { key: Some(key), .. } => format!("{parent}/k{key}"),
        _ => format!("{parent}/{index}"),
    }
}

impl State {
    pub(crate) fn apply(&mut self, msg: TreeMsg) {
        GEN.store(msg.generation, Ordering::SeqCst);
        let (root, subtrees) = self.subtrees.resolve(msg.root);
        sync_fields(&root, "r", msg.ack, &mut self.fields);
        self.page = msg.page;
        self.root = Some(root);
        self.subtrees = subtrees;
    }
}

/// Controlled inputs: take the app's `value` unless the user has typed past what the tree reflects.
fn sync_fields(node: &Node, path: &str, ack: u64, fields: &mut HashMap<String, Field>) {
    let Node::Elem {
        tag,
        attrs,
        children,
        ..
    } = node
    else {
        return;
    };
    if tag == "input" || tag == "textarea" || attrs.contains_key("data-editable") {
        let value = attrs.get("value").cloned().unwrap_or_default();
        let field = fields.entry(path.to_string()).or_insert_with(|| Field {
            edit: TextEdit::new(value.clone()),
            last_sent: 0,
        });
        if ack >= field.last_sent && field.edit.text != value {
            field.edit.text = value;
            let end = field.edit.text.len();
            (field.edit.anchor, field.edit.focus) = (end, end);
        }
    }
    for (i, child) in children.iter().enumerate() {
        sync_fields(child, &child_path(path, i, child), ack, fields);
    }
}

struct Ctx<'a> {
    s: &'a State,
    form: Option<u32>,
    /// Building an inline formatting context's own children, where a space between runs counts.
    inline: bool,
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
            ..
        } => {
            if st.display.as_deref() == Some("none") {
                return None;
            }
            let inh = inh.from(st);
            if tag == "input" || tag == "textarea" {
                return Some(build_input(path, tag, st, attrs, on, inh, ctx));
            }
            if tag == "img" {
                return Some(center_vertically(build_img(path, st, attrs, on, ctx), st));
            }
            if attrs.contains_key("data-editable") {
                return Some(build_editable(path, st, attrs, children, inh, ctx));
            }
            let form = if tag == "form" {
                on.get("submit").copied().or(ctx.form)
            } else {
                ctx.form
            };
            let has_fields = ctx.s.fields.keys().any(|k| k.starts_with(path));
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
                        inline: false,
                    },
                );
                if *observed { observe(e, path, st) } else { e }
            };
            // Unchanged subtrees (same content hash, same inherited text, no live fields) reuse their El.
            let el = if has_fields {
                make()
            } else {
                rune::memo(path.to_string(), (hash, inh.key(), form), make)
            };
            Some(center_vertically(el, st))
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
    // A scroll viewport's content sizes to itself (CSS `flex-1 min-h-full` there grows with the
    // content); Rune's `grow` would pin it to the viewport and leave nothing to scroll.
    let content_sized: Vec<Arc<Node>>;
    let children: &[Arc<Node>] =
        if st.scroll_y == Some(true) && !children.iter().any(fills_with_scroll) {
            content_sized = children.iter().map(size_to_content).collect();
            &content_sized
        } else {
            children
        };
    let kids: Vec<(usize, &Arc<Node>)> = children.iter().enumerate().collect();
    // CSS bounds a filling inner scroller by its scrolling parent; Rune's scroll content is
    // unbounded, so the outer one becomes a clipped flex column and only the inner one scrolls.
    let bounded;
    let st = if st.scroll_y == Some(true) && children.iter().any(fills_with_scroll) {
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
    let inline_row = |inline_text: bool| {
        let mut r = row().items_center().flex_wrap();
        if may_shrink {
            r = r.shrink()
        }
        // `text-align` places an inline formatting context's runs along the line.
        if inline_text {
            r = match inh.align {
                rune::Align::Center => r.justify_center(),
                rune::Align::End => r.justify_end(),
                rune::Align::Start => r,
            }
        }
        r
    };
    let items = st.items.as_deref();
    let inline_ctx = Ctx {
        inline: true,
        ..*ctx
    };
    let mut e = match (st.display.as_deref(), &st.grid_cols) {
        (Some("grid"), Some(cols)) => build_grid(&kids, cols, path, inh, ctx, st),
        (Some("flex"), _) => {
            let is_row = st.dir.as_deref() != Some("col");
            let base = if is_row { row() } else { col() };
            let parent = Parent { is_row, items };
            add_children(apply_flex(base, st), &kids, path, inh, ctx, parent)
        }
        (Some("inline") | None, _)
            if matches!(
                tag,
                "span" | "a" | "kbd" | "label" | "button" | "strong" | "em" | "code" | "time"
            ) =>
        {
            // Inline boxes may shrink below their text, so the text inside can wrap.
            let parent = Parent {
                is_row: true,
                items: Some("center"),
            };
            add_children(
                apply_flex(inline_row(true), st),
                &kids,
                path,
                inh,
                &inline_ctx,
                parent,
            )
        }
        // A block holding only inline content (text, spans, links): an inline formatting context,
        // approximated as a wrapping row so a mention chip stays in its sentence.
        (Some("block") | None, _) if children.len() > 1 && children.iter().all(is_inline) => {
            let parent = Parent {
                is_row: true,
                items: Some("center"),
            };
            add_children(
                apply_flex(inline_row(true), st),
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
            };
            add_children(apply_flex(col(), st), &kids, path, inh, ctx, parent)
        }
    };
    if let Some(wire::BgImage { url: Some(url), .. }) = &st.bg_image
        && let Some(image) = ctx.s.images.get(url, picture_size(st))
    {
        // `background-size: cover`, the common case for avatars and banners.
        e = e.pixels_fit(image.pixels(), SurfaceFit::Fill)
    }
    e = apply_box(e.key(path), st);
    if let Some(label) = attrs.get("aria-label") {
        e = e.label(label.clone());
    }
    if PRESS_EVENTS.iter().any(|k| on.contains_key(*k)) {
        e = press_handlers(e, on);
    } else if let (Some(href), true) = (attrs.get("href"), tag == "a") {
        let href = href.clone();
        e = e.cursor(Cursor::Pointer).on_press(move |_: &mut State| {
            send(0, "link", Some(&href));
        });
    } else if tag == "button" && attrs.get("type").is_none_or(|t| t == "submit") {
        // HTML: a button inside a form submits it unless it says otherwise.
        if let Some(form_id) = ctx.form {
            e = e.cursor(Cursor::Pointer).on_press(move |_: &mut State| {
                send(form_id, "submit", None);
            });
        }
    }
    if let Some(order) = focusable(tag, attrs) {
        e = e.focusable(true).tab_index(order);
    }
    focus_styles(key_and_hover_handlers(e, on), st, false)
}

fn is_inline(node: &Arc<Node>) -> bool {
    match node.as_ref() {
        Node::Text(_) => true,
        Node::Svg { .. } => false,
        Node::Elem {
            tag, st, children, ..
        } => match (st.inline, st.display.as_deref()) {
            // `display: contents` adds no box: inline when what it holds is.
            (_, Some("contents")) => children.iter().all(is_inline),
            (Some(true), _) | (_, Some("inline")) => true,
            (_, None) => matches!(
                tag.as_str(),
                "span"
                    | "a"
                    | "strong"
                    | "em"
                    | "code"
                    | "b"
                    | "i"
                    | "s"
                    | "u"
                    | "mark"
                    | "time"
                    | "br"
            ),
            _ => false,
        },
    }
}

fn size_to_content(node: &Arc<Node>) -> Arc<Node> {
    match node.as_ref() {
        Node::Elem {
            hash,
            tag,
            key,
            st,
            attrs,
            on,
            observed,
            children,
        } if st.grow.is_some() && st.absolute.is_none() => Arc::new(Node::Elem {
            // Its own memo key: the same wire node sized to the viewport is a different El.
            hash: format!("{hash}~content"),
            tag: tag.clone(),
            key: key.clone(),
            st: Style {
                grow: None,
                min_h: None,
                ..st.clone()
            },
            attrs: attrs.clone(),
            on: on.clone(),
            observed: *observed,
            children: children.clone(),
        }),
        _ => node.clone(),
    }
}

/// A child that fills its parent (grows, or is full height) and either scrolls itself or holds
/// such a child: a chain of filling elements down to a scroller (`display: contents` is seen through).
fn fills_with_scroll(node: &Arc<Node>) -> bool {
    let Node::Elem { st, children, .. } = node.as_ref() else {
        return false;
    };
    if st.display.as_deref() == Some("contents") {
        return children.iter().any(fills_with_scroll);
    }
    let fills = st.grow.is_some_and(|g| g.0 > 0.0) || st.h == Some(wire::Len::Full);
    fills && (st.scroll_y == Some(true) || children.iter().any(fills_with_scroll))
}

/// How a container lays out its children, for the children's auto margins.
#[derive(Clone, Copy)]
struct Parent<'a> {
    is_row: bool,
    items: Option<&'a str>,
}

fn style_of(node: &Node) -> Option<&Style> {
    match node {
        Node::Elem { st, .. } | Node::Svg { st, .. } => Some(st),
        Node::Text(_) => None,
    }
}

/// Paint order among siblings. Rune paints in tree order, so positioned children move after
/// the flow (CSS paints them above it), sorted by `z-index`; a negative one goes under the flow.
/// Out-of-flow children take no part in layout, so moving them changes only paint.
fn paint_order<'a>(kids: &[(usize, &'a Arc<Node>)]) -> Vec<(usize, &'a Arc<Node>)> {
    let layer = |node: &Arc<Node>| -> Option<f32> {
        let st = style_of(node)?;
        st.absolute?;
        Some(st.z_index.map_or(0.0, |z| z.0))
    };
    if !kids
        .iter()
        .any(|(_, c)| style_of(c).is_some_and(|st| st.z_index.is_some()))
    {
        return kids.to_vec();
    }
    let mut ordered: Vec<(usize, &Arc<Node>)> = Vec::with_capacity(kids.len());
    let mut positioned: Vec<(f32, usize, &Arc<Node>)> = Vec::new();
    for &(i, child) in kids {
        match layer(child) {
            Some(z) => positioned.push((z, i, child)),
            None => ordered.push((i, child)),
        }
    }
    positioned.sort_by(|a, b| a.0.total_cmp(&b.0));
    let below = positioned.iter().take_while(|p| p.0 < 0.0).count();
    let mut out: Vec<(usize, &Arc<Node>)> =
        positioned[..below].iter().map(|p| (p.1, p.2)).collect();
    out.extend(ordered);
    out.extend(positioned[below..].iter().map(|p| (p.1, p.2)));
    out
}

fn add_children(
    mut e: El,
    kids: &[(usize, &Arc<Node>)],
    path: &str,
    inh: Inherit,
    ctx: &Ctx,
    parent: Parent,
) -> El {
    let grows = |node: &Arc<Node>| {
        style_of(node).is_some_and(|st| st.absolute.is_none() && st.grow.is_some_and(|g| g.0 > 0.0))
    };
    for (i, child) in paint_order(kids) {
        let child_path = child_path(path, i, child);
        // `display: contents`: no box of its own; its children join this one's layout.
        if let Node::Elem { st, children, .. } = child.as_ref()
            && st.display.as_deref() == Some("contents")
        {
            let inner: Vec<(usize, &Arc<Node>)> = children.iter().enumerate().collect();
            e = add_children(e, &inner, &child_path, inh.from(st), ctx, parent);
            continue;
        }
        if let Some(b) = build(child, &child_path, inh, ctx) {
            e = match style_of(child) {
                Some(st) => {
                    let sibling_grows =
                        kids.iter().any(|(_, k)| !Arc::ptr_eq(k, child) && grows(k));
                    e.child(auto_margins(
                        b,
                        st,
                        parent.is_row,
                        parent.items,
                        sibling_grows,
                    ))
                }
                None => e.child(b),
            }
        }
    }
    e
}

/// The size a picture rasterizes for: its own width or height, else a generous default.
fn picture_size(st: &Style) -> f32 {
    match (&st.w, &st.h) {
        (Some(wire::Len::Px(w)), Some(wire::Len::Px(h))) => w.0.max(h.0),
        (Some(wire::Len::Px(v)), _) | (_, Some(wire::Len::Px(v))) => v.0,
        _ => 128.0,
    }
}

/// An inline SVG: a `currentColor` icon tinted with the text colour, or one with its own
/// colours (an avatar's dither pattern) drawn as a picture.
fn build_svg(view: f32, body: &str, st: &Style, par: Option<&str>, inh: Inherit, ctx: &Ctx) -> El {
    let c = color(&st.color).unwrap_or(inh.color);
    let (shape, texts) = svg_text::split(body);
    let body = shape.as_str();
    let labels = |e: El, size: f32| {
        texts
            .iter()
            .fold(e, |e, t| e.child(svg_text::overlay(t, view, size, c)))
    };
    if !images::is_multicolour(body) {
        let size = match st.w {
            Some(wire::Len::Px(wire::F(v))) => v,
            _ => 16.0,
        };
        let e = labels(icon(intern_icon(view, body), size).color(c), size);
        return center_vertically(apply_box(e, st), st);
    }
    let image = ctx.s.images.svg(view, body, picture_size(st));
    // `preserveAspectRatio`: `none` stretches to the box (the dithered avatar), `slice` covers
    // it, and the default (`meet`) fits inside it.
    let mut e = match par.unwrap_or("xMidYMid meet") {
        "none" => el().pixels(image.pixels()),
        p if p.ends_with("slice") => el().pixels_fit(image.pixels(), SurfaceFit::Fill),
        _ => el().pixels_fit(image.pixels(), SurfaceFit::Fit),
    };
    if st.w.is_none() && st.h.is_none() && st.absolute.is_none() {
        // An unsized SVG fills its box; the decorative ones here sit under their siblings.
        e = e.pin(Some(0.0), Some(0.0), Some(0.0), Some(0.0))
    }
    let e = labels(e, picture_size(st));
    center_vertically(apply_box(e, st), st)
}

/// `<img>`: the picture at `src`, fitted by `object-fit`; an empty box until it decodes.
fn build_img(
    path: &str,
    st: &Style,
    attrs: &HashMap<String, String>,
    on: &HashMap<String, u32>,
    ctx: &Ctx,
) -> El {
    let mut e = el().key(path);
    if let Some(image) = attrs
        .get("src")
        .and_then(|src| ctx.s.images.get(src, picture_size(st)))
    {
        e = match st.object_fit.as_deref() {
            Some("cover") => e.pixels_fit(image.pixels(), SurfaceFit::Fill),
            Some("contain" | "scale-down" | "none") => {
                e.pixels_fit(image.pixels(), SurfaceFit::Fit)
            }
            _ => e.pixels(image.pixels()),
        };
    }
    press_handlers(apply_box(e, st), on)
}

/// CSS grid as rows of flex cells. A `col-span-full` child takes a whole row; a `grid-cols-subgrid`
/// child lays its own children into the parent's tracks; positioned children stay out of flow.
fn build_grid(
    kids: &[(usize, &Arc<Node>)],
    cols: &[String],
    path: &str,
    inh: Inherit,
    ctx: &Ctx,
    st: &Style,
) -> El {
    let gap_col = st.gap_col.map(|g| g.0).unwrap_or(0.0);
    let mut grid = col().gaps(st.gap_row.map(|g| g.0).unwrap_or(0.0), 0.0);
    let mut cells: Vec<El> = Vec::new();
    let flush = |grid: El, cells: &mut Vec<El>| -> El {
        if cells.is_empty() {
            return grid;
        }
        let mut r = row().gap(gap_col).w_full();
        if matches!(st.items.as_deref(), Some("start")) {
            r = r.items_start()
        } else {
            r = r.items_center()
        }
        for (cell, template) in cells.drain(..).zip(cols.iter().cycle()) {
            r = r.child(track(cell, template))
        }
        grid.child(r)
    };
    // `display: contents` children are grid items through their own children.
    let mut items: Vec<(String, &Arc<Node>)> = Vec::new();
    fn flatten<'a>(
        children: impl Iterator<Item = (usize, &'a Arc<Node>)>,
        path: &str,
        items: &mut Vec<(String, &'a Arc<Node>)>,
    ) {
        for (i, child) in children {
            let child_path = child_path(path, i, child);
            match child.as_ref() {
                Node::Elem { st, children, .. } if st.display.as_deref() == Some("contents") => {
                    flatten(children.iter().enumerate(), &child_path, items);
                }
                _ => items.push((child_path, child)),
            }
        }
    }
    flatten(kids.iter().map(|(i, c)| (*i, *c)), path, &mut items);
    for (path, child) in items {
        let path = path.as_str();
        if let Node::Elem {
            st: cst,
            children: grand,
            on,
            ..
        } = child.as_ref()
        {
            if cst.absolute.is_some() {
                if let Some(b) = build(child, path, inh, ctx) {
                    grid = grid.child(b)
                }
                continue;
            }
            if cst.col_span_full == Some(true) || cst.subgrid == Some(true) {
                grid = flush(grid, &mut cells);
                let built = if cst.subgrid == Some(true) {
                    let inner: Vec<(usize, &Arc<Node>)> = grand.iter().enumerate().collect();
                    let sub = Style {
                        grid_cols: Some(cols.to_vec()),
                        gap_col: cst.gap_col.or(st.gap_col),
                        ..cst.clone()
                    };
                    let mut e = apply_box(
                        build_grid(&inner, cols, path, inh.from(cst), ctx, &sub).key(path),
                        cst,
                    );
                    e = press_handlers(e, on);
                    Some(e)
                } else {
                    build(child, path, inh, ctx)
                };
                if let Some(b) = built {
                    // A spanning row fills the grid's width unless it sets its own.
                    let b = if cst.w.is_none() { b.w_full() } else { b };
                    grid = grid.child(b)
                }
                continue;
            }
        }
        if let Some(b) = build(child, path, inh, ctx) {
            cells.push(b);
            if cells.len() == cols.len() {
                grid = flush(grid, &mut cells)
            }
        }
    }
    flush(grid, &mut cells)
}

fn build_input(
    path: &str,
    tag: &str,
    st: &Style,
    attrs: &HashMap<String, String>,
    on: &HashMap<String, u32>,
    inh: Inherit,
    ctx: &Ctx,
) -> El {
    let edit = ctx
        .s
        .fields
        .get(path)
        .map(|f| f.edit.clone())
        .unwrap_or_else(|| TextEdit::new(""));
    let key = path.to_string();
    let mut field = text_input(&edit, inh.style())
        .key(format!("{path}/field"))
        .grow(1.0)
        .shrink()
        .color(inh.color)
        .placeholder(
            attrs.get("placeholder").cloned().unwrap_or_default(),
            inh.color.alpha(0.45),
        );
    // A disabled field shows its value but takes no edits, keys or submits, as in a browser.
    if attrs.contains_key("disabled") {
        let wrapper = if tag == "input" {
            row().items_center()
        } else {
            row().items_start()
        };
        let field = if tag == "input" {
            field.single_line()
        } else {
            field
        };
        return apply_box(wrapper.key(path), st).child(field.opacity(0.6));
    }
    field = field.on_edit(rune::edit_access(move |s: &mut State| {
        &mut s
            .fields
            .entry(key.clone())
            .or_insert_with(|| Field {
                edit: TextEdit::new(""),
                last_sent: 0,
            })
            .edit
    }));
    if let Some(&id) = on.get("input") {
        let key = path.to_string();
        field = field.on_input_change(move |s: &mut State, _| {
            if let Some(f) = s.fields.get_mut(&key) {
                f.last_sent = send(id, "input", Some(&f.edit.text))
            }
        });
    }
    // An `<input>` is one line and Return submits its form; a `<textarea>` keeps Rune's
    // multi-line field, where Return types a newline as it does in a browser.
    if tag == "input" {
        field = field.single_line();
        if let Some(form_id) = ctx.form {
            field = field.on_submit(move |_: &mut State, _| {
                send(form_id, "submit", None);
            });
        }
    }
    // A field with its own keydown handler (a combo box) gets its navigation keys, and claims
    // the ones a browser listbox prevents: Return picks rather than submits, arrows move the
    // highlight rather than the caret. Rune's multi-line field submits on a plain Return (a chat
    // composer); a textarea breaks the line instead, so insert it here and report the edit as
    // typing would.
    let keydown = on.get("keydown").copied();
    let (key, input, is_textarea) = (path.to_string(), on.get("input").copied(), tag != "input");
    if keydown.is_some() || is_textarea {
        field = field.on_input_key(move |s: &mut State, ev, _| {
            use rune::edit::Key;
            if let (Some(id), Some(name)) = (keydown, dom_key(&ev.key)) {
                send_key(id, name, ev.mods);
                if matches!(ev.key, Key::Enter | Key::Up | Key::Down | Key::Escape) {
                    return true;
                }
            }
            let plain = ev.mods == rune::edit::Mods::default();
            if !is_textarea || ev.key != Key::Enter || !plain {
                return false;
            }
            if let Some(f) = s.fields.get_mut(&key) {
                f.edit.insert("\n");
                if let Some(id) = input {
                    f.last_sent = send(id, "input", Some(&f.edit.text))
                }
            }
            true
        });
    }
    let wrapper = if tag == "input" {
        row().items_center()
    } else {
        row().items_start()
    };
    focus_styles(apply_box(wrapper.key(path), st), st, true).child(field)
}

/// An element a runtime Mount observes: report its layout, and its offset when it scrolls.
fn observe(e: El, path: &str, st: &Style) -> El {
    let layout_path = path.to_string();
    let e = e.on_layout(move |_: &mut State, [x, y, w, h]: [f32; 4]| {
        write_line(json!({ "t": "layout", "path": layout_path, "x": x, "y": y, "w": w, "h": h }));
    });
    if st.scroll_y != Some(true) {
        return e;
    }
    let scroll_path = path.to_string();
    e.on_scroll_offset(move |at| {
        if std::env::var("NATIVE_DEBUG").is_ok() {
            eprintln!(
                "[host] offset {} max {} viewport {}",
                at.offset[1], at.max[1], at.viewport[1]
            )
        }
        write_line(json!({ "t": "scrolled", "path": scroll_path, "top": at.offset[1] }));
    })
}

/// A multi-line native field over a DOM-backed editor: Return submits, Shift+Return breaks a line.
fn build_editable(
    path: &str,
    st: &Style,
    attrs: &HashMap<String, String>,
    children: &[Arc<Node>],
    inh: Inherit,
    ctx: &Ctx,
) -> El {
    // The editor root's own style (padding, text size, minimum height), sent as the one child.
    let field_st = children.first().and_then(|c| style_of(c));
    let inh = field_st.map_or(inh, |fst| inh.from(fst));
    let edit = ctx
        .s
        .fields
        .get(path)
        .map(|f| f.edit.clone())
        .unwrap_or_else(|| TextEdit::new(""));
    let (edit_key, change_key, submit_key) = (path.to_string(), path.to_string(), path.to_string());
    let field = text_input(&edit, inh.style())
        .key(format!("{path}/field"))
        .grow(1.0)
        .shrink()
        .color(inh.color)
        .placeholder(
            attrs.get("placeholder").cloned().unwrap_or_default(),
            // The editor's placeholder widget: the text colour at `opacity: 0.333`.
            inh.color.alpha(0.333),
        )
        .on_edit(rune::edit_access(move |s: &mut State| {
            &mut s
                .fields
                .entry(edit_key.clone())
                .or_insert_with(|| Field {
                    edit: TextEdit::new(""),
                    last_sent: 0,
                })
                .edit
        }))
        .on_input_change(move |s: &mut State, _| {
            if let Some(f) = s.fields.get_mut(&change_key) {
                f.last_sent = send_editable(&change_key, Some(&f.edit.text), None)
            }
        })
        .on_submit(move |_: &mut State, _| {
            send_editable(&submit_key, None, Some("Enter"));
        });
    let field = match field_st {
        Some(fst) => apply_box(
            row().items_start().grow(1.0).shrink(),
            &Style {
                w: None,
                h: None,
                ..fst.clone()
            },
        )
        .child(field),
        None => field,
    };
    apply_box(row().items_center().key(path), st).child(field)
}

fn report_env(s: &mut State, rect: [f32; 4]) {
    let next = (rect[2].round() as u32, rect[3].round() as u32, s.dark);
    if s.reported == Some(next) || next.0 == 0 {
        return;
    }
    s.reported = Some(next);
    write_line(json!({ "t": "env", "width": next.0, "height": next.1, "dark": next.2 }));
}

pub(crate) fn view(s: &State, cx: &mut Cx<State>) -> El {
    let _ = cx;
    let fallback = if s.dark {
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
        inline: false,
    };
    let body = s.root.as_ref().and_then(|root| build(root, "r", inh, &ctx));
    let mut page = col().w_full().h_full().on_layout(report_env);
    if let Some(bg) = color(&s.page.bg) {
        page = page.fill(bg)
    }
    page.child(body.unwrap_or_else(el))
}

/// Spawns the Bun runtime; its messages arrive on the returned channel.
fn spawn_runtime() -> (std::process::Child, std::sync::mpsc::Receiver<RuntimeMsg>) {
    let entry = std::env::var("HAZEL_NATIVE_ENTRY").unwrap_or_else(|_| "src/entry.ts".into());
    let mut child = Command::new("bun")
        .arg(&entry)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .expect("spawn bun");
    let _ = OUT.set(Mutex::new(Box::new(child.stdin.take().unwrap())));
    let lines = BufReader::new(child.stdout.take().unwrap()).lines();
    let (send, receive) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        for line in lines.map_while(Result::ok) {
            match serde_json::from_str::<RuntimeMsg>(&line) {
                Ok(msg) => {
                    if send.send(msg).is_err() {
                        break;
                    }
                }
                Err(error) => eprintln!("[host] bad message: {error}"),
            }
        }
    });
    (child, receive)
}

/// A downloaded picture landed: rebuild the memoised subtrees that showed its empty box.
fn poll(_: &mut State, _: f64, tx: &mut rune::Tx) -> bool {
    let arrived = images::take_arrived();
    if arrived {
        tx.invalidate_memos_by_prefix("r");
    }
    arrived
}

fn window_size() -> (f32, f32) {
    let width = std::env::var("NATIVE_WIDTH")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(1280.0);
    let height = std::env::var("NATIVE_HEIGHT")
        .ok()
        .and_then(|v| v.parse().ok())
        .unwrap_or(800.0);
    (width, height)
}

fn initial_state() -> State {
    State {
        dark: std::env::var("NATIVE_THEME").as_deref() == Ok("dark"),
        ..State::default()
    }
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if let Some(at) = args.iter().position(|a| a == "--capture") {
        let script = args.get(at + 1).expect("--capture <script.json>");
        capture::run(script);
        return;
    }
    let (mut child, messages) = spawn_runtime();
    // Block on the first tree so the window opens with the app in it.
    let mut initial = initial_state();
    for msg in messages.iter() {
        if let RuntimeMsg::Tree(tree) = msg {
            initial.apply(tree);
            break;
        }
    }
    let spec = AppSpec {
        setup: Some(|_: &mut State, waker| images::set_waker(waker)),
        poll: Some(poll),
        ..AppSpec::new("Hazel", window_size(), State::default, view)
    };
    let app = App::new(spec).init(move || initial);
    let handle = app.handle();
    std::thread::spawn(move || {
        for msg in messages.iter() {
            match msg {
                RuntimeMsg::Tree(tree) => handle.update(move |s: &mut State, _| s.apply(tree)),
                RuntimeMsg::Scroll { path, top } => {
                    handle.update(move |_: &mut State, tx| tx.scroll_to_instant(path, 0.0, top))
                }
            }
        }
    });
    app.run();
    let _ = child.kill();
}
