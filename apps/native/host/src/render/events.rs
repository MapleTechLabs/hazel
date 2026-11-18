//! What the host sends the runtime for input: DOM events, keys, pastes and dismissals.

use serde_json::json;

use crate::outbox::{generation, next_seq, write_line};

use super::state::State;

/// An edit (with the text before it) or key in a native field drawn over a DOM-backed Mount (the
/// composer's editor).
pub(super) fn send_editable(
    path: &str,
    value: Option<&str>,
    key: Option<&str>,
    before: Option<&str>,
) -> u64 {
    let seq = next_seq();
    write_line(json!({
        "t": "event", "seq": seq, "gen": generation(), "id": 0, "type": "editable",
        "path": path, "value": value, "key": key, "before": before,
    }));
    seq
}

/// A paste the composer's editor or the page should hear as a DOM `paste` on `document`: the
/// clipboard's files (paths on disk), its image (PNG, base64; a screenshot has no file) and its
/// text. The web app attaches the files to the composer, or pastes the text into it.
pub(super) fn send_paste(content: &rune::ClipboardContent) {
    use base64::Engine;
    let files: Vec<String> = content
        .files()
        .iter()
        .filter_map(|f| f.to_str().map(str::to_string))
        .collect();
    let image = content
        .image()
        .map(|i| base64::engine::general_purpose::STANDARD.encode(i.png()));
    write_line(json!({ "t": "paste", "text": content.text(), "files": files, "image": image }));
}

/// Whether a paste carries something a text field cannot hold: files or an image.
pub(super) fn pastes_files(content: &rune::ClipboardContent) -> bool {
    content.image().is_some() || !content.files().is_empty()
}

/// The DOM `key` of the keys a field's own keydown handler (a combo box, a picker) acts on.
pub(super) fn dom_key(key: &rune::edit::Key) -> Option<&'static str> {
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
pub(super) fn element_key_name(key: &rune::edit::Key) -> Option<String> {
    match key {
        rune::edit::Key::Text(t) => Some(t.clone()),
        // A character typed with Command (⌘K): the window reports it apart from typed text.
        rune::edit::Key::Command(c) => Some(c.to_string()),
        key => dom_key(key).map(str::to_string),
    }
}

/// A key nothing focused took: it reaches `document`, where an app's shortcuts listen.
pub fn window_key(_: &mut State, ev: &rune::edit::KeyEvent, _: &mut rune::Tx) -> bool {
    if let Some(name) = element_key_name(&ev.key) {
        send_document_key(&name, ev.mods);
    }
    false
}

pub(super) fn send_document_key(name: &str, m: rune::edit::Mods) {
    write_line(
        json!({ "t": "key", "key": name, "shift": m.shift, "meta": m.cmd, "ctrl": m.ctrl, "alt": m.alt }),
    );
}

/// One keydown, dispatched by the runtime as the DOM does: to each handler of `chain` (the
/// focused element's, then those around it) until one stops it, then its default action.
pub(super) fn send_key(chain: &[u32], key: &str, mods: rune::edit::Mods) -> u64 {
    let seq = next_seq();
    write_line(json!({
        "t": "event", "seq": seq, "gen": generation(), "id": chain[0], "chain": &chain[1..],
        "type": "keydown", "key": key, "shift": mods.shift, "meta": mods.cmd, "ctrl": mods.ctrl, "alt": mods.alt,
    }));
    seq
}

/// What a browser fires for one press, in order.
pub const PRESS_EVENTS: [&str; 3] = ["pointerdown", "pointerup", "click"];

pub(super) fn send_click(id: u32, href: &str) -> u64 {
    let seq = next_seq();
    write_line(
        json!({ "t": "event", "seq": seq, "gen": generation(), "id": id, "type": "click", "href": href }),
    );
    seq
}

pub(super) fn send(id: u32, kind: &str, value: Option<&str>) -> u64 {
    let seq = next_seq();
    write_line(
        json!({ "t": "event", "seq": seq, "gen": generation(), "id": id, "type": kind, "value": value }),
    );
    seq
}

/// Pointer events: `pointer-events: none` drops their handlers; keys, focus and input stay.
pub(super) const POINTER_ONLY_EVENTS: [&str; 7] = [
    "click",
    "pointerdown",
    "pointerup",
    "mouseenter",
    "mouseleave",
    "contextmenu",
    "dblclick",
];

pub(super) fn send_dismiss(path: &str) {
    write_line(json!({ "t": "dismiss", "path": path }));
}
