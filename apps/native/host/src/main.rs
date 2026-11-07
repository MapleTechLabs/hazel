//! Hazel's native window: draws the tree Hazel's Foldkit app renders in a Bun child process and
//! sends presses, edits and the window's size and theme back to it.
mod capture;
mod layout;
mod wire;

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{ChildStdin, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};

use rune::edit::TextEdit;
use rune::text::Icon;
use rune::{App, AppSpec, Color, Cursor, Cx, El, col, el, icon, row, text, text_input};
use serde_json::json;

use layout::{Inherit, apply_box, apply_flex, center_vertically, color, track};
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
}

static OUT: OnceLock<Mutex<ChildStdin>> = OnceLock::new();
static SEQ: AtomicU64 = AtomicU64::new(0);
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
        json!({ "t": "event", "seq": seq, "id": 0, "type": "editable", "path": path, "value": value, "key": key }),
    );
    seq
}

fn send(id: u32, kind: &str, value: Option<&str>) -> u64 {
    let seq = SEQ.fetch_add(1, Ordering::SeqCst) + 1;
    write_line(json!({ "t": "event", "seq": seq, "id": id, "type": kind, "value": value }));
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
}

fn build(node: &Arc<Node>, path: &str, inh: Inherit, ctx: &Ctx) -> Option<El> {
    match node.as_ref() {
        Node::Text(s) => {
            if s.trim().is_empty() {
                return None;
            }
            let mut t = text(s.clone()).font(inh.style()).color(inh.color);
            t = if inh.truncate {
                t.single_line().truncate().shrink()
            } else if inh.nowrap {
                t.single_line()
            } else {
                t.wrap().shrink()
            };
            Some(t)
        }
        Node::Svg { view, body, st, .. } => {
            let size = match st.w {
                Some(wire::Len::Px(wire::F(v))) => v,
                _ => 16.0,
            };
            let c = color(&st.color).unwrap_or(inh.color);
            Some(apply_box(icon(intern_icon(*view, body), size).color(c), st))
        }
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
                return Some(build_input(path, st, attrs, on, inh, ctx));
            }
            if attrs.contains_key("data-editable") {
                return Some(build_editable(path, st, attrs, inh, ctx));
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
                    &Ctx { s: ctx.s, form },
                );
                if *observed { observe(e, path, st) } else { e }
            };
            // Unchanged subtrees (same content hash, same inherited text, no live fields) reuse their El.
            let el = if has_fields {
                make()
            } else {
                let inherited = (
                    inh.color.hex(),
                    inh.size.to_bits(),
                    inh.line.to_bits(),
                    inh.weight.to_bits(),
                    inh.truncate,
                );
                rune::memo(path.to_string(), (hash, inherited, form), make)
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
    let mut e = match (st.display.as_deref(), &st.grid_cols) {
        (Some("grid"), Some(cols)) => build_grid(&kids, cols, path, inh, ctx, st),
        (Some("flex"), _) => {
            let base = if st.dir.as_deref() == Some("col") {
                col()
            } else {
                row()
            };
            add_children(apply_flex(base, st), &kids, path, inh, ctx)
        }
        (Some("inline") | None, _)
            if matches!(
                tag,
                "span" | "a" | "kbd" | "label" | "button" | "strong" | "em" | "code" | "time"
            ) =>
        {
            // Inline boxes may shrink below their text, so the text inside can wrap.
            add_children(
                apply_flex(row().items_center().shrink().flex_wrap(), st),
                &kids,
                path,
                inh,
                ctx,
            )
        }
        // A block holding only inline content (text, spans, links): an inline formatting context,
        // approximated as a wrapping row so a mention chip stays in its sentence.
        (Some("block") | None, _) if children.len() > 1 && children.iter().all(is_inline) => {
            add_children(
                apply_flex(row().flex_wrap().items_center().shrink(), st),
                &kids,
                path,
                inh,
                ctx,
            )
        }
        _ => add_children(apply_flex(col(), st), &kids, path, inh, ctx),
    };
    if tag == "img" {
        // Images arrive in a follow-up; keep the box and paint a neutral fill.
        e = e.fill(inh.color.alpha(0.12));
    }
    e = apply_box(e.key(path), st);
    if let Some(&id) = on.get("click") {
        e = e.cursor(Cursor::Pointer).on_press(move |_: &mut State| {
            send(id, "click", None);
        });
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
    e
}

fn is_inline(node: &Arc<Node>) -> bool {
    match node.as_ref() {
        Node::Text(_) => true,
        Node::Svg { .. } => false,
        Node::Elem { tag, st, .. } => match (st.inline, st.display.as_deref()) {
            (Some(true), _) => true,
            (_, None) => matches!(
                tag.as_str(),
                "span" | "a" | "strong" | "em" | "code" | "b" | "i" | "s" | "u" | "mark" | "time"
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
            hash: hash.clone(),
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

fn add_children(
    mut e: El,
    kids: &[(usize, &Arc<Node>)],
    path: &str,
    inh: Inherit,
    ctx: &Ctx,
) -> El {
    for (i, child) in kids {
        let child_path = child_path(path, *i, child);
        // `display: contents`: no box of its own; its children join this one's layout.
        if let Node::Elem { st, children, .. } = child.as_ref()
            && st.display.as_deref() == Some("contents")
        {
            let inner: Vec<(usize, &Arc<Node>)> = children.iter().enumerate().collect();
            e = add_children(e, &inner, &child_path, inh.from(st), ctx);
            continue;
        }
        if let Some(b) = build(child, &child_path, inh, ctx) {
            e = e.child(b)
        }
    }
    e
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
                    if let Some(&id) = on.get("click") {
                        e = e.cursor(Cursor::Pointer).on_press(move |_: &mut State| {
                            send(id, "click", None);
                        });
                    }
                    Some(e)
                } else {
                    build(child, path, inh, ctx)
                };
                if let Some(b) = built {
                    grid = grid.child(b.w_full())
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
        .single_line()
        .grow(1.0)
        .shrink()
        .color(inh.color)
        .placeholder(
            attrs.get("placeholder").cloned().unwrap_or_default(),
            inh.color.alpha(0.45),
        )
        .on_edit(rune::edit_access(move |s: &mut State| {
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
    if let Some(form_id) = ctx.form {
        field = field.on_submit(move |_: &mut State, _| {
            send(form_id, "submit", None);
        });
    }
    apply_box(row().items_center().key(path), st).child(field)
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
    inh: Inherit,
    ctx: &Ctx,
) -> El {
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
            inh.color.alpha(0.45),
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
        size: 16.0,
        line: 24.0,
        weight: 400.0,
        truncate: false,
        nowrap: false,
    };
    let ctx = Ctx { s, form: None };
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
    let _ = OUT.set(Mutex::new(child.stdin.take().unwrap()));
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
    let app =
        App::new(AppSpec::new("Hazel", window_size(), State::default, view)).init(move || initial);
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
