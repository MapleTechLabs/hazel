//! What the host keeps of the runtime's tree between frames: the tree, its text fields' editors,
//! the portals drawn at the window's root, and the viewport last reported to the runtime.

use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use rune::edit::TextEdit;
use serde_json::json;

use crate::html::is_text_field;
use crate::outbox::{set_generation, write_line};
use crate::wire::{self, Node, Subtrees, TreeMsg};
use crate::{frames, images, margins};

use super::handlers::scroll_seqs;

/// A text field's editor state, owned here because Rune's editor lives in app state.
pub(crate) struct Field {
    pub(crate) edit: TextEdit,
    /// Seq of the last edit sent; the app's `value` wins once the runtime has seen it.
    pub(crate) last_sent: u64,
    /// The text as last sent or taken from the app: the next edit's `before`, against which the
    /// runtime rebases it when the app's text has moved on (an editor reshaped what was typed).
    pub(crate) shown: String,
}

impl Field {
    pub(super) fn new(text: String) -> Self {
        Field {
            edit: TextEdit::new(text.clone()),
            last_sent: 0,
            shown: text,
        }
    }
}

/// The byte offset in `text` of `units` UTF-16 code units (a JavaScript string offset), clamped.
fn byte_offset(text: &str, units: usize) -> usize {
    let mut seen = 0;
    for (at, c) in text.char_indices() {
        if seen >= units {
            return at;
        }
        seen += c.len_utf16();
    }
    text.len()
}

#[derive(Default)]
pub struct State {
    pub(crate) root: Option<Arc<Node>>,
    pub(crate) subtrees: Subtrees,
    pub(crate) fields: HashMap<String, Field>,
    /// The appearance a headless capture runs with (`NATIVE_THEME`); a window follows macOS's.
    pub(crate) dark: bool,
    /// The document's own background and text colour (`body` in the app's stylesheet).
    pub(crate) page: wire::Page,
    pub(crate) images: images::Images,
    /// Elements drawn at the window's root (`ov.portal`), by path, in tree order.
    pub(crate) portals: Vec<(String, Arc<Node>)>,
    /// The content hash of the tree on screen, as the runtime sent its root.
    pub(crate) root_hash: Option<String>,
    /// The `<iframe>`s in the tree: each one's page shows in a web view over its box.
    pub(crate) frames: Vec<frames::FrameSpec>,
    /// What the overlays among `portals` draw over the page, and so over those web views.
    pub(crate) covers: Vec<frames::CoverSpec>,
    /// How far the on-screen keyboard covers the window's bottom edge, in points (iOS).
    pub(crate) keyboard: f32,
}

/// What the runtime's viewport is: its size, the system appearance, and the safe area (the
/// edges of the page the system draws over, `env(safe-area-inset-*)`), in points.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Env {
    pub width: u32,
    pub height: u32,
    pub dark: bool,
    /// Top, right, bottom, left.
    pub inset: [u32; 4],
}

impl Env {
    /// The `env` line the runtime reads.
    pub fn line(&self) -> serde_json::Value {
        json!({
            "t": "env",
            "width": self.width,
            "height": self.height,
            "dark": self.dark,
            "inset": self.inset,
        })
    }
}

/// The env last sent: what a size or appearance change is compared with, and what a runtime that
/// replaces the first is told.
static REPORTED: Mutex<Option<Env>> = Mutex::new(None);

/// The window size, theme and safe area last reported to the runtime.
pub fn last_env() -> Option<Env> {
    *REPORTED.lock().unwrap()
}

/// A child's path under `parent`: by its key when it has one, else by its place among its siblings.
pub fn child_path(parent: &str, index: usize, node: &Node) -> String {
    match node {
        Node::Elem { key: Some(key), .. } => format!("{parent}/k{key}"),
        _ => format!("{parent}/{index}"),
    }
}

impl State {
    /// An empty window in the given appearance.
    pub fn new(dark: bool) -> Self {
        State {
            dark,
            ..State::default()
        }
    }

    /// The tree on screen.
    pub fn root(&self) -> Option<&Arc<Node>> {
        self.root.as_ref()
    }

    pub fn dark(&self) -> bool {
        self.dark
    }

    /// The on-screen keyboard now covers this much of the window's bottom edge: the page's
    /// viewport ends above it, as a browser's does. Whether that changed anything.
    pub fn set_keyboard(&mut self, covered: f32) -> bool {
        let changed = self.keyboard != covered;
        self.keyboard = covered;
        changed
    }

    /// Takes the runtime's tree. Whether anything the view reads changed: a tree that is the
    /// one on screen again (the app answered an event with no change) leaves the view as built.
    pub fn apply(&mut self, msg: TreeMsg) -> bool {
        set_generation(msg.generation);
        if let (wire::WireNode::Ref { h }, Some(shown), Some(root)) =
            (&msg.root, &self.root_hash, &self.root)
            && h == shown
        {
            // Its fields may still owe the app's value to an edit this tree acknowledges.
            let fields_changed = sync_fields(root, "r", msg.ack, &mut self.fields, None);
            let page_changed = self.page != msg.page;
            self.page = msg.page;
            return fields_changed || page_changed;
        }
        self.root_hash = msg.root.hash().map(str::to_string);
        let (root, subtrees) = self.subtrees.resolve(msg.root);
        // CSS collapses vertical margins in block flow; Rune's layout does not, so do it here.
        let root = margins::collapse(&root, false);
        // A field gone from the tree goes from here too: its path may hold another field later,
        // which must start from the app's text, and a live field under an element turns its memo off.
        let mut live = HashSet::new();
        sync_fields(&root, "r", msg.ack, &mut self.fields, Some(&mut live));
        self.fields.retain(|path, _| live.contains(path));
        self.page = msg.page;
        self.portals.clear();
        collect_portals(&root, "r", &mut self.portals);
        self.frames = frames::collect(&root);
        self.covers = if self.frames.is_empty() {
            Vec::new()
        } else {
            frames::collect_covers(&root, &self.portals)
        };
        self.root = Some(root);
        self.subtrees = subtrees;
        true
    }

    /// A fresh runtime replaced the one that drew this (a full page load, a restart after a
    /// crash): what the host kept for the old one's trees, edits and scrolls means nothing to it.
    /// The screen keeps the old tree until the new runtime's first one arrives.
    pub fn runtime_replaced(&mut self) {
        self.fields.clear();
        self.root_hash = None;
        self.subtrees = Subtrees::default();
        scroll_seqs().lock().expect("scroll seqs").clear();
    }
}

/// An element drawn at the window's root rather than where the tree puts it: a portal the runtime
/// asked for (`ov.portal`), or a `fixed` element, which the window places as the browser's
/// viewport does.
pub(crate) fn is_portal(node: &Arc<Node>) -> bool {
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
/// Whether any field's text changed.
/// `live`, when given, collects every field's path.
fn sync_fields(
    node: &Node,
    path: &str,
    ack: u64,
    fields: &mut HashMap<String, Field>,
    mut live: Option<&mut HashSet<String>>,
) -> bool {
    let Node::Elem {
        tag,
        attrs,
        children,
        ..
    } = node
    else {
        return false;
    };
    let mut changed = false;
    if is_text_field(tag, attrs) || attrs.contains_key("data-editable") {
        let value = attrs.get("value").cloned().unwrap_or_default();
        if let Some(live) = live.as_deref_mut() {
            live.insert(path.to_string());
        }
        // A new field takes the app's text below, caret and all, as a changed one does.
        let field = fields
            .entry(path.to_string())
            .or_insert_with(|| Field::new(String::new()));
        if ack >= field.last_sent && field.edit.text != value {
            // The caret where the app's says (an editor's), else at the end.
            let caret = attrs
                .get("data-caret")
                .and_then(|units| units.parse().ok())
                .map_or(value.len(), |units| byte_offset(&value, units));
            field.edit.text = value.clone();
            field.shown = value;
            (field.edit.anchor, field.edit.focus) = (caret, caret);
            changed = true;
        }
    }
    for (i, child) in children.iter().enumerate() {
        changed |= sync_fields(
            child,
            &child_path(path, i, child),
            ack,
            fields,
            live.as_deref_mut(),
        );
    }
    changed
}

/// `NATIVE_THEME=dark|light` pins the appearance (benchmarks, captures); otherwise it is macOS's.
pub(super) fn theme_override() -> Option<bool> {
    match std::env::var("NATIVE_THEME").as_deref() {
        Ok("dark") => Some(true),
        Ok("light") => Some(false),
        _ => None,
    }
}

/// The appearance the view last drew with, which the runtime's `prefers-color-scheme` follows.
static DARK: AtomicBool = AtomicBool::new(false);

/// The view runs again when the system appearance changes: tell the runtime, whose media
/// queries (and so the app's System theme) follow it. The size comes from the last report.
pub(super) fn note_appearance(dark: bool) {
    if DARK.swap(dark, Ordering::Relaxed) == dark {
        return;
    }
    let mut reported = REPORTED.lock().unwrap();
    if let Some(env) = reported.as_mut() {
        env.dark = dark;
        write_line(env.line());
    }
}

/// Tells the runtime the page's size and safe area when either changed.
pub(super) fn report_env(rect: [f32; 4], inset: [f32; 4]) {
    let next = Env {
        width: rect[2].round() as u32,
        height: rect[3].round() as u32,
        dark: DARK.load(Ordering::Relaxed),
        inset: inset.map(|edge| edge.max(0.0).round() as u32),
    };
    let mut reported = REPORTED.lock().unwrap();
    if *reported == Some(next) || next.width == 0 {
        return;
    }
    *reported = Some(next);
    write_line(next.line());
}
