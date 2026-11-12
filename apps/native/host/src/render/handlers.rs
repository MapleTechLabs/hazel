//! The handlers an element's DOM listeners become: presses, keys, hover, focus, and the layout
//! and scroll reports a Mount observes.

use std::collections::HashMap;

use rune::{Cursor, El};
use serde_json::json;

use crate::html::{focusable, is_checkable, script_focusable};
use crate::layout::focus_styles;
use crate::outbox::write_line;
use crate::wire::Style;

use super::Ctx;
use super::events::{PRESS_EVENTS, element_key_name, send, send_click, send_key};
use super::state::State;

/// A press as the browser reports it, for the handlers the element has. Rune reports a press
/// when it is released, so all of them go then (a menu opens on release, not on press). A link's
/// click carries its `href`, which the runtime follows unless the handler prevents it.
pub(super) fn press_handlers(e: El, on: &HashMap<String, u32>, href: Option<&String>) -> El {
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

/// What a press on the element does: its click handlers, else a link's navigation, else a
/// button's form submit, as a browser's default actions.
pub(super) fn presses(
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
    // A shell that opens the system's menu on a held press has a finger, not a pointer: a touch
    // must not report as hovering, or the message toolbar opens under every press.
    let report = attrs
        .get("data-hover-report")
        .filter(|_| crate::islands::draws("context-menu").is_none())
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

/// What every element takes from its attributes and handlers beyond presses: a Tab stop, keys,
/// hover events, and the rings and fills focus and presses draw.
pub(super) fn behaviour(
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
    // Tauri's drag attribute: pressing the element (not the controls in it) moves the window.
    if attrs.contains_key("data-tauri-drag-region") {
        e = e.window_drag();
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

/// An element a runtime Mount observes: report its layout, and its offset when it scrolls.
pub(super) fn observe(e: El, path: &str, st: &Style) -> El {
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

/// Applies a runtime scroll: `by` shifts the viewport from where it is now (`element.scrollBy`),
/// which leaves a finger's drag and a fling's momentum running; otherwise it jumps to `top`.
pub fn apply_scroll(tx: &mut rune::Tx, path: String, top: f32, by: Option<f32>) {
    if std::env::var("NATIVE_DEBUG").is_ok() {
        match by {
            Some(by) => eprintln!("[host] scroll_by {by}"),
            None => eprintln!("[host] scroll_to {top}"),
        }
    }
    match by {
        Some(by) => tx.scroll_by(path, by),
        None => tx.scroll_to_instant(path, 0.0, top),
    }
}

/// Notes a runtime scroll's `seq` for the offset reports after it.
pub fn note_scroll(path: &str, seq: Option<u64>) {
    if let Some(seq) = seq {
        let mut seqs = scroll_seqs().lock().expect("scroll seqs");
        // Scrolls arrive in order; a replaced runtime numbers its own from the start again.
        seqs.insert(path.to_string(), seq);
    }
}

/// A press anywhere on a text field's box (its padding, a composer's empty lines) puts the caret
/// in it, as clicking a padded `<input>` or editor does in a browser.
pub(super) fn focus_field_on_press(e: El, path: &str) -> El {
    let field = format!("{path}/field");
    e.cursor(Cursor::Text)
        .on_press_tx(move |_: &mut State, tx| tx.focus(field.clone()))
}
