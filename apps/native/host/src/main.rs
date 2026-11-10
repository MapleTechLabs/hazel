//! Hazel's native window: draws the tree Hazel's Foldkit app renders in a Bun child process and
//! sends presses, edits and the window's size and theme back to it.
mod capture;
mod images;
mod layout;
mod margins;
mod platform;
mod svg_text;
#[cfg(test)]
mod tests;
mod wire;

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::Stdio;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

use rune::edit::TextEdit;
use rune::text::Icon;
use rune::{
    Align, App, AppSpec, Color, Cursor, Cx, El, Side, SurfaceFit, col, el, icon, row, text_input,
};
use serde_json::json;

use layout::{
    ASCENT, DESCENT, Inherit, apply_box, apply_flex, auto_margins, center_vertically, color,
    focus_styles, focusable, grid_track, is_checkable, is_text_field, script_focusable, text_run,
};
use wire::{F, Node, RuntimeMsg, Style, Subtrees, TreeMsg};

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
    /// Elements drawn at the window's root (`ov.portal`), by path, in tree order.
    portals: Vec<(String, Arc<Node>)>,
}

static OUT: OnceLock<Mutex<Box<dyn Write + Send>>> = OnceLock::new();
static SEQ: AtomicU64 = AtomicU64::new(0);
/// The generation of the tree on screen: an event runs the handler of the tree it was pressed on.
static GEN: AtomicU64 = AtomicU64::new(0);
/// The window size and theme last sent, for a runtime that replaces the first.
static REPORTED: Mutex<Option<(u32, u32, bool)>> = Mutex::new(None);
static ICONS: Mutex<Option<HashMap<String, &'static Icon>>> = Mutex::new(None);

pub(crate) fn write_line(message: serde_json::Value) {
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
        Key::Left => "ArrowLeft",
        Key::Right => "ArrowRight",
        Key::Backspace => "Backspace",
        Key::Delete => "Delete",
        _ => return None,
    })
}

/// A key's DOM `key` as an element's keydown hears it: a named key, or the character typed
/// (type-to-select in a menu, a shortcut's letter).
fn element_key_name(key: &rune::edit::Key) -> Option<String> {
    match key {
        rune::edit::Key::Text(t) => Some(t.clone()),
        key => dom_key(key).map(str::to_string),
    }
}

/// A key nothing focused took: it reaches `document`, where an app's shortcuts listen.
pub(crate) fn window_key(_: &mut State, ev: &rune::edit::KeyEvent, _: &mut rune::Tx) -> bool {
    if let Some(name) = element_key_name(&ev.key) {
        send_document_key(&name, ev.mods);
    }
    false
}

fn send_document_key(name: &str, m: rune::edit::Mods) {
    write_line(
        json!({ "t": "key", "key": name, "shift": m.shift, "meta": m.cmd, "ctrl": m.ctrl, "alt": m.alt }),
    );
}

/// One keydown, dispatched by the runtime as the DOM does: to each handler of `chain` (the
/// focused element's, then those around it) until one stops it, then its default action.
fn send_key(chain: &[u32], key: &str, mods: rune::edit::Mods) -> u64 {
    let seq = SEQ.fetch_add(1, Ordering::SeqCst) + 1;
    write_line(json!({
        "t": "event", "seq": seq, "gen": GEN.load(Ordering::SeqCst), "id": chain[0], "chain": &chain[1..],
        "type": "keydown", "key": key, "shift": mods.shift, "meta": mods.cmd, "ctrl": mods.ctrl, "alt": mods.alt,
    }));
    seq
}

/// What a browser fires for one press, in order.
/// The web app sets `-webkit-font-smoothing: antialiased` on `html`: text without CoreText's
/// smoothing dilation, lighter than macOS's default.
pub(crate) const TEXT_SMOOTHING: rune::FontSmoothing = rune::FontSmoothing::Off;

const PRESS_EVENTS: [&str; 3] = ["pointerdown", "pointerup", "click"];

/// A press as the browser reports it, for the handlers the element has. Rune reports a press
/// when it is released, so all of them go then (a menu opens on release, not on press). A link's
/// click carries its `href`, which the runtime follows unless the handler prevents it.
fn press_handlers(e: El, on: &HashMap<String, u32>, href: Option<&String>) -> El {
    let events: Vec<(&'static str, u32)> = PRESS_EVENTS
        .iter()
        .filter_map(|kind| on.get(*kind).map(|&id| (*kind, id)))
        .collect();
    if events.is_empty() {
        return e;
    }
    let href = href.cloned();
    e.cursor(Cursor::Pointer).on_press(move |_: &mut State| {
        for (kind, id) in &events {
            match (&href, *kind) {
                (Some(href), "click") => send_click(*id, href),
                _ => send(*id, kind, None),
            };
        }
    })
}

fn send_click(id: u32, href: &str) -> u64 {
    let seq = SEQ.fetch_add(1, Ordering::SeqCst) + 1;
    write_line(
        json!({ "t": "event", "seq": seq, "gen": GEN.load(Ordering::SeqCst), "id": id, "type": "click", "href": href }),
    );
    seq
}

/// A `<table>`: one grid whose columns every row shares, so cells line up as in CSS table
/// layout. Each row's cells take its background, bottom border and hover (shared across the
/// row); a cell's `colspan` spans columns. Cells keep their own paths.
fn build_table<'a>(
    path: &str,
    st: &Style,
    children: &'a [Arc<Node>],
    inh: Inherit,
    ctx: &Ctx,
) -> El {
    struct Row<'a> {
        path: String,
        st: Style,
        cells: Vec<(String, &'a Arc<Node>)>,
    }
    let mut rows: Vec<Row<'a>> = Vec::new();
    let mut add_row = |row_path: String, row: &'a Arc<Node>, group: Option<&Style>| {
        let Node::Elem {
            st: rst, children, ..
        } = row.as_ref()
        else {
            return;
        };
        let mut merged = group.cloned().unwrap_or_default();
        for (field, value) in [
            (&mut merged.bg, &rst.bg),
            (&mut merged.hover_bg, &rst.hover_bg),
        ] {
            if value.is_some() {
                *field = value.clone();
            }
        }
        if rst.border.is_some() {
            merged.border = rst.border;
            merged.border_color = rst.border_color.clone();
        }
        merged.color = rst.color.clone().or(merged.color);
        let cells = children
            .iter()
            .enumerate()
            .filter(
                |(_, c)| matches!(c.as_ref(), Node::Elem { tag, .. } if tag == "td" || tag == "th"),
            )
            .map(|(i, c)| (child_path(&row_path, i, c), c))
            .collect();
        rows.push(Row {
            path: row_path,
            st: merged,
            cells,
        });
    };
    for (i, child) in children.iter().enumerate() {
        let group_path = child_path(path, i, child);
        match child.as_ref() {
            Node::Elem { tag, .. } if tag == "tr" => add_row(group_path, child, None),
            Node::Elem {
                tag,
                st: gst,
                children: rows_of,
                ..
            } if matches!(tag.as_str(), "thead" | "tbody" | "tfoot") => {
                for (j, row) in rows_of.iter().enumerate() {
                    add_row(child_path(&group_path, j, row), row, Some(gst));
                }
            }
            _ => {}
        }
    }
    let span = |cell: &Arc<Node>| match cell.as_ref() {
        Node::Elem { attrs, .. } => attrs
            .get("colspan")
            .and_then(|n| n.parse::<u16>().ok())
            .unwrap_or(1)
            .max(1),
        _ => 1,
    };
    let columns = rows
        .iter()
        .map(|r| {
            r.cells
                .iter()
                .map(|(_, c)| usize::from(span(c)))
                .sum::<usize>()
        })
        .max()
        .unwrap_or(1);
    // CSS's automatic table layout: each column gets its widest cell's max-content width and
    // a share of the spare width in proportion to it, which `fr` tracks so weighted give.
    let mut widths = vec![0.0_f32; columns];
    for row in &rows {
        let row_inh = inh.from(&row.st);
        let mut at = 0;
        for (_, cell) in &row.cells {
            let n = usize::from(span(cell));
            if n == 1
                && let Some(w) = widths.get_mut(at)
            {
                *w = w.max(max_content(cell, row_inh));
            }
            at += n;
        }
    }
    let tracks = widths.iter().map(|w| rune::GridTrack::Fr(w.max(1.0)));
    let mut grid = el().grid_columns(tracks.collect::<Vec<_>>());
    for row in &rows {
        let row_inh = inh.from(&row.st);
        for (cell_path, cell) in &row.cells {
            let Node::Elem {
                hash,
                tag,
                key,
                st: cst,
                attrs,
                on,
                observed,
                ov,
                children,
            } = cell.as_ref()
            else {
                continue;
            };
            let border_bottom = row.st.border.map_or(0.0, |b| b[2].0);
            let decorated = Style {
                bg: cst.bg.clone().or_else(|| row.st.bg.clone()),
                hover_bg: cst.hover_bg.clone().or_else(|| row.st.hover_bg.clone()),
                hover_share: row.st.hover_bg.as_ref().map(|_| row.path.clone()),
                border: if cst.border.is_none() && border_bottom > 0.0 {
                    Some([F(0.0), F(0.0), F(border_bottom), F(0.0)])
                } else {
                    cst.border
                },
                border_color: cst
                    .border_color
                    .clone()
                    .or_else(|| row.st.border_color.clone()),
                col_span: Some(span(cell)),
                ..cst.clone()
            };
            let decorated = Arc::new(Node::Elem {
                hash: format!("{hash}~row"),
                tag: tag.clone(),
                key: key.clone(),
                st: decorated,
                attrs: attrs.clone(),
                on: on.clone(),
                observed: *observed,
                ov: ov.clone(),
                children: children.clone(),
            });
            if let Some(cell) = build(&decorated, cell_path, row_inh, ctx) {
                // A cell's content sits in the middle of its row (`vertical-align: middle`).
                let block = matches!(cst.display.as_deref(), None | Some("block" | "table-cell"));
                grid = grid.child(if block { cell.justify_center() } else { cell });
            }
        }
    }
    apply_box(grid.key(path), st)
}

/// A box's max-content width, estimated: text measured as drawn, a row's children side by side,
/// a column's widest child, an explicit width as given, plus padding and borders.
fn max_content(node: &Node, inh: Inherit) -> f32 {
    match node {
        Node::Text(t) => rune::text::measure(t.trim(), &[], inh.style(), None).0,
        Node::Svg { st, .. } => match st.w {
            Some(wire::Len::Px(w)) => w.0,
            _ => 16.0,
        },
        Node::Elem {
            st, children, tag, ..
        } => {
            if st.display.as_deref() == Some("none") || st.absolute.is_some() {
                return 0.0;
            }
            let side = |b: Option<[F; 4]>| b.map_or(0.0, |b| b[1].0 + b[3].0);
            let edges = side(st.pad) + side(st.border) + side(st.margin);
            if let Some(wire::Len::Px(w)) = st.w {
                return w.0 + side(st.margin);
            }
            let own = inh.from(st);
            let kids = children.iter().map(|c| max_content(c, own));
            let row = match st.display.as_deref() {
                Some("flex") => st.dir.as_deref() != Some("col"),
                Some("grid") => false,
                _ => is_inline_tag(tag) || children.iter().all(is_inline),
            };
            let inner = if row {
                let gap = st.gap_col.map_or(0.0, |g| g.0) * children.len().saturating_sub(1) as f32;
                kids.sum::<f32>() + gap
            } else {
                kids.fold(0.0, f32::max)
            };
            inner + edges
        }
    }
}

fn is_inline_tag(tag: &str) -> bool {
    matches!(
        tag,
        "span" | "a" | "strong" | "em" | "code" | "b" | "i" | "kbd" | "time" | "label"
    )
}

/// What a press on the element does: its click handlers, else a link's navigation, else a
/// button's form submit, as a browser's default actions.
fn presses(
    e: El,
    path: &str,
    tag: &str,
    attrs: &HashMap<String, String>,
    on: &HashMap<String, u32>,
    ctx: &Ctx,
) -> El {
    if ctx.no_pointer {
        return e;
    }
    // A press or Space on a checkbox toggles it, and on an unchecked radio checks it: `change`.
    if is_checkable(tag, attrs)
        && let Some(&change) = on.get("change")
    {
        let checks =
            attrs.get("type").is_some_and(|t| t == "checkbox") || !attrs.contains_key("checked");
        let click = on.get("click").copied();
        return e.cursor(Cursor::Pointer).on_press(move |_: &mut State| {
            if let Some(id) = click {
                send(id, "click", None);
            }
            if checks {
                send(change, "change", None);
            }
        });
    }
    if PRESS_EVENTS.iter().any(|k| on.contains_key(*k)) {
        return press_handlers(e, on, link_href(tag, attrs));
    }
    if let Some(href) = link_href(tag, attrs) {
        let href = href.clone();
        return e.cursor(Cursor::Pointer).on_press(move |_: &mut State| {
            send(0, "link", Some(&href));
        });
    }
    // A label's default action: a press on it activates its control (the runtime finds it).
    if tag == "label" {
        let path = path.to_string();
        return e.on_press(move |_: &mut State| {
            write_line(json!({ "t": "label", "path": path }));
        });
    }
    // HTML: a button inside a form submits it unless it says otherwise.
    match ctx.form {
        Some(form_id) if tag == "button" && attrs.get("type").is_none_or(|t| t == "submit") => {
            e.cursor(Cursor::Pointer).on_press(move |_: &mut State| {
                send(form_id, "submit", None);
            })
        }
        _ => e,
    }
}

/// The `href` a press on this element follows: a link's.
fn link_href<'a>(tag: &str, attrs: &'a HashMap<String, String>) -> Option<&'a String> {
    attrs.get("href").filter(|_| tag == "a")
}

/// `keydown` while the element or one inside it has focus (Tab stays focus navigation),
/// `mouseenter`/`mouseleave` as the pointer crosses it, and, for an element a pointer-tracking
/// Mount watches (`data-hover-report`), a `pointer` report to that Mount, and its right-clicks.
fn key_and_hover_handlers(
    mut e: El,
    path: &str,
    attrs: &HashMap<String, String>,
    on: &HashMap<String, u32>,
    outer: &[u32],
) -> El {
    if let Some(&id) = on.get("keydown") {
        let chain: Vec<u32> = std::iter::once(id).chain(outer.iter().copied()).collect();
        e = e.on_key(move |_: &mut State, ev: &rune::edit::KeyEvent, _| {
            // Tab stays focus navigation; every other key is the element's keydown.
            let Some(name) = element_key_name(&ev.key).filter(|n| n != "Tab") else {
                return false;
            };
            send_key(&chain, &name, ev.mods);
            true
        });
    }
    let (enter, leave) = (on.get("mouseenter").copied(), on.get("mouseleave").copied());
    let report = attrs
        .get("data-hover-report")
        .map(|mount| (path.to_string(), mount.clone()));
    let right_click = report.clone();
    if enter.is_some() || leave.is_some() || report.is_some() {
        e = e.on_hover_change(move |_: &mut State, inside, _| {
            let event = if inside {
                enter.map(|id| (id, "mouseenter"))
            } else {
                leave.map(|id| (id, "mouseleave"))
            };
            if let Some((id, kind)) = event {
                send(id, kind, None);
            }
            if let Some((path, mount)) = &report {
                write_line(
                    json!({ "t": "pointer", "path": path, "mount": mount, "inside": inside }),
                );
            }
        });
    }
    // A right-click there reaches the Mount as a `contextmenu` at the pointer (a context menu),
    // with where the elements from the Mount's down to this one are: the menu measures the
    // pointer against its trigger (`getBoundingClientRect`).
    if let Some((path, mount)) = right_click {
        e = e.on_secondary_press(move |_: &mut State, at: rune::PointerPress, tx| {
            let below = path.strip_prefix(mount.as_str()).unwrap_or("");
            let mut keys = vec![mount.clone()];
            for segment in below.split('/').filter(|s| !s.is_empty()) {
                keys.push(format!("{}/{segment}", keys[keys.len() - 1]));
            }
            let (path, mount) = (path.clone(), mount.clone());
            tx.drawn_rects(keys.clone(), move |_: &mut State, rects, _| {
                let rects: serde_json::Map<String, serde_json::Value> = keys
                    .into_iter()
                    .zip(rects)
                    .filter_map(|(key, rect)| Some((key, json!(rect?))))
                    .collect();
                write_line(json!({
                    "t": "contextmenu", "path": path, "mount": mount,
                    "x": at.x, "y": at.y, "rects": rects,
                }));
            });
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
        // CSS collapses vertical margins in block flow; Rune's layout does not, so do it here.
        let root = margins::collapse(&root, false);
        sync_fields(&root, "r", msg.ack, &mut self.fields);
        self.page = msg.page;
        self.portals.clear();
        collect_portals(&root, "r", &mut self.portals);
        self.root = Some(root);
        self.subtrees = subtrees;
    }
}

/// An element the runtime asked to draw at the window's root (`ov.portal`).
/// Drawn at the window's root rather than where the tree puts it: a portal, or a `fixed`
/// element, which the window places as the browser's viewport does.
fn is_portal(node: &Arc<Node>) -> bool {
    match node.as_ref() {
        Node::Elem { ov, st, .. } => {
            ov.as_ref().is_some_and(|o| o.portal.is_some()) || st.fixed == Some(true)
        }
        _ => false,
    }
}

fn collect_portals(node: &Arc<Node>, path: &str, out: &mut Vec<(String, Arc<Node>)>) {
    let Node::Elem { children, .. } = node.as_ref() else {
        return;
    };
    if is_portal(node) {
        out.push((path.to_string(), node.clone()));
    }
    for (i, child) in children.iter().enumerate() {
        collect_portals(child, &child_path(path, i, child), out);
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
    if is_text_field(tag, attrs) || attrs.contains_key("data-editable") {
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

/// Pointer events: `pointer-events: none` drops their handlers; keys, focus and input stay.
const POINTER_ONLY_EVENTS: [&str; 7] = [
    "click",
    "pointerdown",
    "pointerup",
    "mouseenter",
    "mouseleave",
    "contextmenu",
    "dblclick",
];

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
            if tag == "table" && st.display.as_deref() != Some("none") {
                return Some(build_table(path, st, children, inh, ctx));
            }
            if attrs.contains_key("data-editable") {
                return Some(build_editable(path, st, attrs, children, inh, ctx));
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
            let has_fields = ctx.s.fields.keys().any(|k| k.starts_with(path));
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
                    (hash, inh.key(), form, keys.to_vec()),
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
    // A grid with rows only has one implicit column.
    let one_column = [String::from("auto")];
    let grid_cols = st
        .grid_cols
        .as_deref()
        .or(st.grid_rows.as_ref().map(|_| &one_column[..]));
    let mut e = match (st.display.as_deref(), grid_cols) {
        (Some("grid"), Some(cols)) => build_grid(&kids, cols, path, inh, ctx, st),
        (Some("flex"), _) => {
            let is_row = st.dir.as_deref() != Some("col");
            let base = if is_row { row() } else { col() };
            let parent = Parent {
                is_row,
                items,
                block: false,
            };
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
                block: false,
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
        (Some("block") | None, _) if kids.len() > 1 && kids.iter().all(|(_, c)| is_inline(c)) => {
            let parent = Parent {
                is_row: true,
                items: Some("center"),
                block: false,
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
                block: true,
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

/// What every element takes from its attributes and handlers beyond presses: a Tab stop, keys,
/// hover events, and the rings and fills focus and presses draw.
fn behaviour(
    mut e: El,
    path: &str,
    tag: &str,
    attrs: &HashMap<String, String>,
    on: &HashMap<String, u32>,
    st: &Style,
    outer: &[u32],
) -> El {
    // As in the DOM, a control takes focus with no area (a visually hidden button, an empty list).
    if let Some(order) = focusable(tag, attrs) {
        e = e.focusable(true).tab_index(order).focusable_when_empty();
    } else if script_focusable(attrs) {
        e = e.focusable_by_script().focusable_when_empty();
    }
    // A radio's arrow keys move through its group, as a browser's do; the runtime knows the group.
    if is_checkable(tag, attrs) && attrs.get("type").is_some_and(|t| t == "radio") {
        let path = path.to_string();
        e = e.on_key(move |_: &mut State, ev: &rune::edit::KeyEvent, _| {
            use rune::edit::Key;
            let step = match ev.key {
                Key::Down | Key::Right => 1,
                Key::Up | Key::Left => -1,
                _ => return false,
            };
            write_line(json!({ "t": "radio", "path": path, "step": step }));
            true
        });
    }
    focus_styles(key_and_hover_handlers(e, path, attrs, on, outer), st, false)
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
                    | "label"
                    | "kbd"
                    | "small"
                    | "abbr"
                    | "sub"
                    | "sup"
            ),
            _ => false,
        },
    }
}

fn size_to_content(node: &Arc<Node>) -> Arc<Node> {
    drop_grow(node, true)
}

/// `node` without its `grow` (and its `min-h`, with `min_h_too`), under its own memo key.
fn drop_grow(node: &Arc<Node>, min_h_too: bool) -> Arc<Node> {
    match node.as_ref() {
        Node::Elem {
            hash,
            tag,
            key,
            st,
            attrs,
            on,
            observed,
            ov,
            children,
        } if st.grow.is_some() && st.absolute.is_none() => Arc::new(Node::Elem {
            // Its own memo key: the same wire node sized to the viewport is a different El.
            hash: format!("{hash}~{}", if min_h_too { "content" } else { "basis" }),
            tag: tag.clone(),
            key: key.clone(),
            st: Style {
                grow: None,
                min_h: if min_h_too { None } else { st.min_h.clone() },
                ..st.clone()
            },
            attrs: attrs.clone(),
            on: on.clone(),
            observed: *observed,
            ov: ov.clone(),
            children: children.clone(),
        }),
        _ => node.clone(),
    }
}

/// A child that keeps a scrolling flex column from overflowing, as CSS flexes it: one that
/// fills with a scroller, or one that grows and may shrink to nothing (`flex-1 min-h-0`, or
/// `overflow: hidden`, whose automatic minimum size is zero).
fn bounds_scroller(node: &Arc<Node>) -> bool {
    if fills_with_scroll(node) {
        return true;
    }
    let Node::Elem { st, .. } = node.as_ref() else {
        return false;
    };
    st.grow.is_some_and(|g| g.0 > 0.0)
        && st.shrink.is_none_or(|s| s.0 > 0.0)
        && (st.min_h == Some(wire::Len::Px(wire::F(0.0))) || st.clip == Some(true))
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

/// `children` with each run of adjacent text nodes as one, at the first one's index: the DOM
/// lays `["6", " users"]` out as one text (and one flex item). `None` when no two are adjacent.
fn join_text(children: &[Arc<Node>]) -> Option<Vec<(usize, Arc<Node>)>> {
    let is_text = |node: &Arc<Node>| matches!(node.as_ref(), Node::Text(_));
    if !children
        .windows(2)
        .any(|pair| is_text(&pair[0]) && is_text(&pair[1]))
    {
        return None;
    }
    let mut out: Vec<(usize, Arc<Node>)> = Vec::with_capacity(children.len());
    for (i, child) in children.iter().enumerate() {
        match (out.last_mut(), child.as_ref()) {
            (Some((_, last)), Node::Text(more)) if is_text(last) => {
                let Node::Text(text) = last.as_ref() else {
                    continue;
                };
                *last = Arc::new(Node::Text(format!("{text}{more}")));
            }
            _ => out.push((i, child.clone())),
        }
    }
    Some(out)
}

/// How a container lays out its children, for the children's auto margins.
#[derive(Clone, Copy)]
struct Parent<'a> {
    is_row: bool,
    items: Option<&'a str>,
    /// A block container: its inline-level children (`inline-flex`, `inline-block`) keep their
    /// own width and sit where `text-align` puts them, rather than stretching across it.
    block: bool,
}

fn style_of(node: &Node) -> Option<&Style> {
    match node {
        Node::Elem { st, .. } | Node::Svg { st, .. } => Some(st),
        Node::Text(_) => None,
    }
}

/// Paint order among siblings. Rune paints in tree order, so positioned children move after
/// the flow (CSS paints them above it), sorted by `z-index`; a negative one, or one below a flow
/// child's own `z-index`, goes under the flow.
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
    // A flow child with a `z-index` (`relative z-20`, a flex item's) stacks above a positioned
    // sibling with a lower one: that sibling paints under the flow (a background image).
    let flow_z = ordered
        .iter()
        .filter_map(|(_, c)| style_of(c).and_then(|st| st.z_index).map(|z| z.0))
        .fold(0.0, f32::max);
    let below = positioned
        .iter()
        .take_while(|p| p.0 < 0.0 || p.0 < flow_z)
        .count();
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
    // `align-items: baseline`: the children start at the top and each drops by what its first
    // baseline lacks of the deepest one. One with no text keeps to the bottom, as before.
    let deepest = if parent.is_row && parent.items == Some("baseline") {
        kids.iter()
            .filter_map(|(_, child)| first_baseline(child, inh))
            .reduce(f32::max)
    } else {
        None
    };
    if deepest.is_some() {
        e = e.items_start();
    }
    for (i, child) in paint_order(kids) {
        let child_path = child_path(path, i, child);
        if is_portal(child) && ctx.portal != Some(child_path.as_str()) {
            continue;
        }
        // `display: contents`: no box of its own; its children join this one's layout.
        if let Node::Elem { st, children, .. } = child.as_ref()
            && st.display.as_deref() == Some("contents")
        {
            let inner: Vec<(usize, &Arc<Node>)> = children.iter().enumerate().collect();
            // It has no box to trim either: its text is still this box's own.
            let through = Inherit {
                trim: inh.trim,
                ..inh.from(st)
            };
            e = add_children(e, &inner, &child_path, through, ctx, parent);
            continue;
        }
        if let Some(b) = build(child, &child_path, inh, ctx) {
            let b = match style_of(child) {
                Some(st)
                    if parent.block
                        && st.absolute.is_none()
                        && (is_atomic_inline(child, st) || is_inline(child)) =>
                {
                    let [mt, _, mb, _] = st.margin.map_or([0.0; 4], |m| m.map(|v| v.0));
                    let atomic = is_atomic_inline(child, st);
                    let (top, bottom) = line_box_space(child, st, inh, atomic);
                    if top > 0.0 || bottom > 0.0 {
                        b.mt(mt + top).mb(mb + bottom)
                    } else {
                        b
                    }
                }
                _ => b,
            };
            let b = match style_of(child) {
                Some(st)
                    if parent.block
                        && (st.inline == Some(true) || is_inline(child))
                        && st.absolute.is_none()
                        && st.w.is_none() =>
                {
                    match inh.align {
                        rune::Align::Center => b.self_center(),
                        rune::Align::End => b.self_end(),
                        _ => b.self_start(),
                    }
                }
                _ => b,
            };
            let b = match (deepest, first_baseline(child, inh)) {
                (Some(deepest), Some(own)) => {
                    let mt = style_of(child)
                        .and_then(|st| st.margin)
                        .map_or(0.0, |m| m[0].0);
                    b.mt(mt + deepest - own)
                }
                (Some(_), None) => b.self_end(),
                _ => b,
            };
            // `fit-content` across the parent's cross axis is a size, so `align-items: stretch`
            // (and a block's own stretch) leaves the box at its content's, at the start.
            let b = match style_of(child) {
                Some(st) if st.absolute.is_none() && st.align_self.is_none() => {
                    let cross = if parent.is_row { &st.h } else { &st.w };
                    if *cross == Some(wire::Len::Fit) {
                        b.self_start()
                    } else {
                        b
                    }
                }
                _ => b,
            };
            // A `w-full` item beside others in a row: CSS's default `flex-shrink: 1` gives the
            // others their room. Rune boxes keep their size unless told to shrink.
            let b = match style_of(child) {
                Some(st)
                    if parent.is_row
                        && kids.len() > 1
                        && st.w == Some(wire::Len::Full)
                        && st.shrink.is_none()
                        && st.min_w.is_none()
                        && st.absolute.is_none() =>
                {
                    b.shrink()
                }
                _ => b,
            };
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

/// Space a CSS line box adds above and below an atomic inline child (`inline-block`) of a
/// block: the child sits on the baseline of a line at least as tall as the parent's strut. A
/// child with no text has its baseline at its bottom edge, so the strut's descent shows below
/// it. A text child aligns its first line's baseline (one line assumed). Others: none.
fn line_box_space(node: &Node, st: &Style, inh: Inherit, atomic: bool) -> (f32, f32) {
    let metrics = |size: f32, line: f32| {
        let half_leading = (line - (ASCENT + DESCENT) * size) / 2.0;
        (half_leading + ASCENT * size, half_leading + DESCENT * size)
    };
    let (strut_above, strut_below) = metrics(inh.size, inh.line);
    // An inline box's own padding, border and margin do not size its line; an inline-block's do.
    let edge = |side: usize| {
        if !atomic {
            return 0.0;
        }
        [st.margin, st.border, st.pad]
            .iter()
            .map(|b| b.map_or(0.0, |b| b[side].0))
            .sum::<f32>()
    };
    let (above, below) = if has_text(node) {
        if st.h.is_some() {
            return (0.0, 0.0);
        }
        let own = inh.from(st);
        let (a, b) = metrics(own.size, own.line);
        // A trimmed box ends at its metric: that much less of it lies above and below the baseline.
        (edge(0) + a - own.trim[0], edge(2) + b - own.trim[1])
    } else {
        let Some(wire::Len::Px(h)) = st.h else {
            return (0.0, 0.0);
        };
        let [mt, _, mb, _] = st.margin.map_or([0.0; 4], |m| m.map(|v| v.0));
        (mt + h.0 + mb, 0.0)
    };
    (
        (strut_above - above).max(0.0),
        (strut_below - below).max(0.0),
    )
}

/// How far below a node's top margin edge its first line of text has its baseline; `None`
/// when it holds no text in flow. Chromium lays lines out on whole-pixel font metrics.
fn first_baseline(node: &Node, inh: Inherit) -> Option<f32> {
    match node {
        Node::Text(text) if text.trim().is_empty() => None,
        Node::Text(_) => {
            let (ascent, descent) = ((ASCENT * inh.size).round(), (DESCENT * inh.size).round());
            let half_leading = ((inh.line - ascent - descent) / 2.0).floor();
            Some(half_leading + ascent - inh.trim[0])
        }
        Node::Svg { .. } => None,
        Node::Elem { st, children, .. } => {
            if st.display.as_deref() == Some("none") || st.absolute.is_some() {
                return None;
            }
            let own = inh.from(st);
            let edge: f32 = [st.margin, st.border, st.pad]
                .iter()
                .map(|b| b.map_or(0.0, |b| b[0].0))
                .sum();
            children
                .iter()
                .find_map(|child| first_baseline(child, own))
                .map(|inner| edge + inner)
        }
    }
}

/// An `inline-block`-like box: `inline-flex`/`inline-block`, or a control a browser draws so.
fn is_atomic_inline(node: &Node, st: &Style) -> bool {
    match (st.inline, st.display.as_deref(), node) {
        (Some(inline), _, _) => inline,
        (None, None, Node::Elem { tag, .. }) => {
            matches!(
                tag.as_str(),
                "button" | "img" | "input" | "select" | "textarea"
            )
        }
        _ => false,
    }
}

/// Whether text flows inside the node (not in an absolutely placed descendant).
fn has_text(node: &Node) -> bool {
    match node {
        Node::Text(t) => !t.trim().is_empty(),
        Node::Svg { .. } => false,
        Node::Elem { st, children, .. } => {
            st.display.as_deref() != Some("none")
                && st.absolute.is_none()
                && children.iter().any(|c| has_text(c))
        }
    }
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
    let mask = st.mask.as_ref().filter(|m| m.image.is_some());
    let local = attrs.get("src").filter(|src| images::is_local(src));
    if let (Some(src), Some(mask)) = (local, mask) {
        // A mask picture is placed in the box, so the picture composites at the box's own size:
        // nothing shows until it is laid out and the composite is ready.
        let size = rune::memo::layout_size(path).filter(|[w, h]| *w > 0.0 && *h > 0.0);
        let fit = st.object_fit.as_deref();
        if let Some(image) = size.and_then(|size| ctx.s.images.masked(src, mask, size, fit)) {
            e = e.pixels(image.pixels());
        }
    } else if let Some(image) = attrs
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
    press_handlers(apply_box(e, st), on, None)
}

/// CSS grid on Rune's grid tracks. `display: contents` children are grid items through their own
/// children. Taffy has no subgrid, so a subgrid item spans its row and lays its children out on
/// the same column tracks (an `auto` column then sizes per row, not across the grid).
fn build_grid(
    kids: &[(usize, &Arc<Node>)],
    cols: &[String],
    path: &str,
    inh: Inherit,
    ctx: &Ctx,
    st: &Style,
) -> El {
    let mut grid = el().grid_columns(cols.iter().map(|c| grid_track(c))).gaps(
        st.gap_row.map(|g| g.0).unwrap_or(0.0),
        st.gap_col.map(|g| g.0).unwrap_or(0.0),
    );
    grid = match st.items.as_deref() {
        Some("start" | "flex-start") => grid.items_start(),
        Some("center") => grid.items_center(),
        Some("end" | "flex-end") => grid.items_end(),
        _ => grid,
    };
    if let Some(rows) = &st.grid_rows {
        grid = grid.grid_rows(rows.iter().map(|r| grid_track(r)));
    }
    if st.justify_items.as_deref() == Some("center") {
        grid = grid.grid_justify_center();
    }
    let mut items: Vec<(String, &Arc<Node>)> = Vec::new();
    fn flatten<'a>(
        children: impl Iterator<Item = (usize, &'a Arc<Node>)>,
        path: &str,
        items: &mut Vec<(String, &'a Arc<Node>)>,
    ) {
        for (i, child) in children {
            let child_path = child_path(path, i, child);
            // A portal draws at the window's root (`view`), not in the grid.
            if is_portal(child) {
                continue;
            }
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
        let built = match child.as_ref() {
            Node::Elem {
                st: cst,
                children: grand,
                on,
                tag,
                attrs,
                ..
            } if cst.subgrid == Some(true) && cst.absolute.is_none() => {
                let inner: Vec<(usize, &Arc<Node>)> = grand.iter().enumerate().collect();
                let sub = Style {
                    grid_cols: Some(cols.to_vec()),
                    gap_col: cst.gap_col.or(st.gap_col),
                    ..cst.clone()
                };
                let e = build_grid(&inner, cols, path, inh.from(cst), ctx, &sub).key(path);
                let e = presses(apply_box(e, cst), path, tag, attrs, on, ctx);
                let e = behaviour(e, path, tag, attrs, on, cst, ctx.keys).grid_column_full();
                // A subgrid always stretches across its tracks: `justify-items` does not place it.
                let centred = st.justify_items.as_deref() == Some("center");
                Some(if centred && cst.w.is_none() {
                    e.w_full()
                } else {
                    e
                })
            }
            Node::Elem { st: cst, .. } if cst.col_span_full == Some(true) => {
                build(child, path, inh, ctx).map(El::grid_column_full)
            }
            _ => build(child, path, inh, ctx),
        };
        let row_start = match child.as_ref() {
            Node::Elem { st: cst, .. } => cst.row_start,
            _ => None,
        };
        if let Some(b) = built {
            grid = grid.child(match row_start {
                Some(line) => b.grid_row_start(line),
                None => b,
            })
        }
    }
    grid
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
    let outer = ctx.keys.to_vec();
    if keydown.is_some() || is_textarea || !outer.is_empty() {
        field = field.on_input_key(move |s: &mut State, ev, _| {
            use rune::edit::Key;
            // The field's own handler, then the elements around it as the key bubbles.
            let name = dom_key(&ev.key);
            let chain: Vec<u32> = keydown.iter().chain(&outer).copied().collect();
            if let Some(name) = name.filter(|_| !chain.is_empty()) {
                send_key(&chain, name, ev.mods);
            } else if ev.mods.cmd || ev.mods.ctrl || ev.key == Key::Escape {
                // No handler around the field: a shortcut or Escape still reaches `document`.
                if let Some(name) = element_key_name(&ev.key) {
                    send_document_key(&name, ev.mods);
                }
            }
            // A field with its own handler (a combo box) claims what a listbox prevents; Escape
            // stops at an element around it (a popover closes). Return still submits a form.
            let claimed = keydown.is_some() && matches!(ev.key, Key::Enter | Key::Up | Key::Down);
            if name.is_some()
                && (claimed || ev.key == Key::Escape && (keydown.is_some() || !outer.is_empty()))
            {
                return true;
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
    focus_styles(
        focus_field_on_press(apply_box(wrapper.key(path), st), path),
        st,
        true,
    )
    .child(field)
}

/// An element a runtime Mount observes: report its layout, and its offset when it scrolls.
fn observe(e: El, path: &str, st: &Style) -> El {
    let layout_path = path.to_string();
    // A report for the runtime, no change to the host's own state: no need to build its view
    // again, which inside a scrolling list would be every frame.
    let e = e.on_layout_tx(move |_: &mut State, [x, y, w, h]: [f32; 4], tx| {
        tx.live_only();
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
        let seq = scroll_seqs()
            .lock()
            .expect("scroll seqs")
            .get(&scroll_path)
            .copied()
            .unwrap_or(0);
        write_line(
            json!({ "t": "scrolled", "path": scroll_path, "top": at.offset[1], "seq": seq }),
        );
    })
}

/// The last runtime scroll the host applied to each viewport: its offset reports carry that
/// scroll's `seq`, so the runtime can tell the ones sent before it apart.
pub(crate) fn scroll_seqs() -> &'static std::sync::Mutex<HashMap<String, u64>> {
    static SEQS: std::sync::OnceLock<std::sync::Mutex<HashMap<String, u64>>> =
        std::sync::OnceLock::new();
    SEQS.get_or_init(Default::default)
}

/// Notes a runtime scroll's `seq` for the offset reports after it.
pub(crate) fn note_scroll(path: &str, seq: Option<u64>) {
    if let Some(seq) = seq {
        let mut seqs = scroll_seqs().lock().expect("scroll seqs");
        let entry = seqs.entry(path.to_string()).or_default();
        *entry = (*entry).max(seq);
    }
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
    focus_field_on_press(apply_box(row().items_center().key(path), st), path).child(field)
}

/// A press anywhere on a text field's box (its padding, a composer's empty lines) puts the caret
/// in it, as clicking a padded `<input>` or editor does in a browser.
fn focus_field_on_press(e: El, path: &str) -> El {
    let field = format!("{path}/field");
    e.cursor(Cursor::Text)
        .on_press_tx(move |_: &mut State, tx| tx.focus(field.clone()))
}

/// A DOM element appears and vanishes at once; one fades only when its CSS says so (`Style`'s
/// `transition` and `animation`), where Rune would fade every element in and out.
pub(crate) fn dom_motion() {
    rune::set_default_transition(rune::Transition::none());
}

fn report_env(s: &mut State, rect: [f32; 4]) {
    let next = (rect[2].round() as u32, rect[3].round() as u32, s.dark);
    if s.reported == Some(next) || next.0 == 0 {
        return;
    }
    s.reported = Some(next);
    *REPORTED.lock().unwrap() = Some(next);
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
        keys: &[],
        inline: false,
        portal: None,
        no_pointer: false,
    };
    let body = s.root.as_ref().and_then(|root| build(root, "r", inh, &ctx));
    let mut page = col().w_full().h_full().on_layout(report_env);
    if let Some(bg) = color(&s.page.bg) {
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
    page
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

fn send_dismiss(path: &str) {
    write_line(json!({ "t": "dismiss", "path": path }));
}

/// The runtime process running now; a reload replaces it.
#[derive(Clone)]
pub(crate) struct RuntimeChild(Arc<Mutex<Option<std::process::Child>>>);

impl RuntimeChild {
    pub(crate) fn id(&self) -> u32 {
        self.0
            .lock()
            .unwrap()
            .as_ref()
            .map_or(0, std::process::Child::id)
    }

    pub(crate) fn kill(&mut self) {
        if let Some(mut child) = self.0.lock().unwrap().take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }

    /// Asks the runtime to exit (SIGTERM), so it finishes what it writes on exit (a CPU
    /// profile), and kills it if it has not gone within 3 s.
    pub(crate) fn stop(&mut self) {
        if let Some(mut child) = self.0.lock().unwrap().take() {
            let _ = std::process::Command::new("kill")
                .args(["-TERM", &child.id().to_string()])
                .status();
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(3);
            while std::time::Instant::now() < deadline {
                if matches!(child.try_wait(), Ok(Some(_))) {
                    return;
                }
                std::thread::sleep(std::time::Duration::from_millis(20));
            }
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

/// Starts a runtime at `path` (`NATIVE_PATH`), writing to it from now on; returns its stdout.
fn start_runtime(current: &RuntimeChild, path: Option<&str>) -> std::process::ChildStdout {
    let host = std::env::current_exe().ok();
    let host_dir = host.as_deref().and_then(std::path::Path::parent);
    let mut command = platform::runtime_command(host_dir, std::env::var("HAZEL_NATIVE_ENTRY").ok());
    if let Some(path) = path {
        command.env("NATIVE_PATH", path);
    }
    let mut child = command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::inherit())
        .spawn()
        .expect("spawn the runtime");
    let stdin: Box<dyn Write + Send> = Box::new(child.stdin.take().unwrap());
    *OUT.get_or_init(|| Mutex::new(Box::new(std::io::sink())))
        .lock()
        .unwrap() = stdin;
    let stdout = child.stdout.take().unwrap();
    *current.0.lock().unwrap() = Some(child);
    stdout
}

/// Spawns the runtime (the bundled one, else Bun); its messages arrive on the returned channel.
/// A `reload` (a full page load in the app) replaces it with a fresh one at the new path.
fn spawn_runtime() -> (RuntimeChild, std::sync::mpsc::Receiver<RuntimeMsg>) {
    let current = RuntimeChild(Arc::new(Mutex::new(None)));
    let mut stdout = start_runtime(&current, None);
    let (send, receive) = std::sync::mpsc::channel();
    let mut supervised = current.clone();
    std::thread::spawn(move || {
        loop {
            let mut reload = None;
            for line in BufReader::new(stdout).lines().map_while(Result::ok) {
                match serde_json::from_str::<RuntimeMsg>(&line) {
                    Ok(RuntimeMsg::Vault { id, op, record }) => answer_vault(id, &op, record),
                    Ok(RuntimeMsg::Reload { path }) => {
                        reload = Some(path);
                        break;
                    }
                    Ok(msg) => {
                        if send.send(msg).is_err() {
                            return;
                        }
                    }
                    Err(error) => eprintln!("[host] bad message: {error}"),
                }
            }
            let Some(path) = reload else { return };
            supervised.kill();
            stdout = start_runtime(&supervised, Some(&path));
            // The new runtime starts at the default size: tell it the window's.
            if let Some((width, height, dark)) = *REPORTED.lock().unwrap() {
                write_line(json!({ "t": "env", "width": width, "height": height, "dark": dark }));
            }
        }
    });
    (current, receive)
}

/// Keychain calls can wait on a permission prompt: each runs off the reader and UI threads.
fn answer_vault(id: u64, op: &str, record: Option<String>) {
    let Some(op) = wire::vault_op(op, record) else {
        write_line(platform::vault_reply(
            id,
            Err(format!("unknown vault request {op}")),
        ));
        return;
    };
    std::thread::spawn(move || {
        write_line(platform::vault_reply(
            id,
            platform::run_vault(platform::VAULT_SERVICE, &op),
        ));
    });
}

/// A link the system opened with the app (the sign-in callback): to the runtime as it came.
fn open_url(_: &mut State, url: &str, _: &mut rune::Tx) {
    write_line(platform::open_url_message(url));
}

/// A downloaded picture landed: rebuild the memoised subtrees that showed its empty box.
pub(crate) fn poll(_: &mut State, _: f64, tx: &mut rune::Tx) -> bool {
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
    dom_motion();
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
        on_key: Some(window_key),
        ..AppSpec::new("Hazel", window_size(), State::default, view)
    };
    let app = App::new(spec)
        .font_smoothing(TEXT_SMOOTHING)
        .init(move || initial)
        .on_open_url(open_url);
    let handle = app.handle();
    std::thread::spawn(move || {
        for msg in messages.iter() {
            match msg {
                RuntimeMsg::Tree(tree) => handle.update(move |s: &mut State, _| s.apply(tree)),
                RuntimeMsg::Scroll { path, top, seq } => {
                    note_scroll(&path, seq);
                    handle.update(move |_: &mut State, tx| tx.scroll_to_instant(path, 0.0, top))
                }
                request => {
                    if let Some(run) = request.request() {
                        handle.update(move |_: &mut State, tx| run(tx))
                    }
                }
            }
        }
    });
    app.run();
    child.kill();
}
